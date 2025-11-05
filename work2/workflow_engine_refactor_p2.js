// src/core/workflow-engine.js - REFACTORED (Part 2: Step Execution)

  // ============================================================================
  // STEP EXECUTION METHODS - UPDATED
  // ============================================================================

  /**
   * Execute prompt step (unchanged from original, just for completeness)
   */
  async executePromptStep(step, context) {
    const { prompt, providers, useThinking, providerContexts, providerMeta } = step.payload;
    
    return new Promise((resolve, reject) => {
      this.orchestrator.executeParallelFanout(prompt, providers, {
        sessionId: context.sessionId,
        useThinking,
        providerContexts,
        providerMeta,
        onPartial: (providerId, chunk) => {
          const delta = makeDelta(context.sessionId, providerId, chunk.text);
          if (delta && delta.length > 0) {
            this.port.postMessage({ 
              type: 'PARTIAL_RESULT', 
              sessionId: context.sessionId, 
              stepId: step.stepId, 
              providerId, 
              chunk: { text: delta } 
            });
            logger.stream('Delta dispatched:', { stepId: step.stepId, providerId, len: delta.length });
          }
        },
        onAllComplete: (results, errors) => {
          results.forEach((res, pid) => {
            this.sessionManager.updateProviderContext(
              context.sessionId, 
              pid, 
              res, 
              true, 
              { skipSave: true }
            );
          });
          this.sessionManager.saveSession(context.sessionId);

          const formattedResults = {};
          
          results.forEach((result, providerId) => {
            formattedResults[providerId] = {
              providerId: providerId,
              text: result.text || '',
              status: 'completed',
              meta: result.meta || {},
              ...(result.softError ? { softError: result.softError } : {})
            };
          });
          
          errors.forEach((error, providerId) => {
            formattedResults[providerId] = {
              providerId: providerId,
              text: '',
              status: 'failed',
              meta: { _rawError: error.message }
            };
          });

          const hasAnyValidResults = Object.values(formattedResults).some(
            r => r.status === 'completed' && r.text && r.text.trim().length > 0
          );

          if (!hasAnyValidResults) {
            reject(new Error('All providers failed or returned empty responses'));
            return;
          }
          
          resolve({ 
            results: formattedResults, 
            errors: Object.fromEntries(errors) 
          });
        }
      });
    });
  }

  /**
   * UPDATED: Resolve source data with ResolvedContext support
   */
  async resolveSourceData(payload, context, previousResults, resolvedContext) {
    if (payload.sourceHistorical) {
      // Historical source - use frozen outputs from ResolvedContext if available
      if (resolvedContext && resolvedContext.type === 'recompute') {
        console.log('[WorkflowEngine] Using frozen outputs from ResolvedContext');
        return Object.values(resolvedContext.frozenBatchOutputs).map(res => ({
          providerId: res.providerId,
          text: res.text
        }));
      }

      // Fallback: fetch from session (legacy path)
      const { turnId: userTurnId, responseType } = payload.sourceHistorical;
      console.log(`[WorkflowEngine] Resolving historical data from turn: ${userTurnId}`);
      
      let session = this.sessionManager.sessions[context.sessionId];
      let aiTurn = null;
      
      if (session && Array.isArray(session.turns)) {
        const userTurnIndex = session.turns.findIndex(t => t.id === userTurnId && t.type === 'user');
        if (userTurnIndex !== -1) {
          aiTurn = session.turns[userTurnIndex + 1];
        }
      }

      if (!aiTurn) {
        const allSessions = this.sessionManager.sessions || {};
        for (const [sid, s] of Object.entries(allSessions)) {
          if (!s || !Array.isArray(s.turns)) continue;
          const idx = s.turns.findIndex(t => t.id === userTurnId && t.type === 'user');
          if (idx !== -1) {
            aiTurn = s.turns[idx + 1];
            session = s;
            console.warn(`[WorkflowEngine] Historical turn ${userTurnId} found in different session ${sid}`);
            break;
          }
        }
      }

      if (!aiTurn || aiTurn.type !== 'ai') {
        throw new Error(`Could not find corresponding AI turn for ${userTurnId}`);
      }
      
      let sourceContainer;
      switch(responseType) {
        case 'synthesis': 
          sourceContainer = aiTurn.synthesisResponses || {}; 
          break;
        case 'mapping': 
          sourceContainer = aiTurn.mappingResponses || {}; 
          break;
        default: 
          sourceContainer = aiTurn.batchResponses || {}; 
          break;
      }
      
      const sourceArray = Object.values(sourceContainer)
        .flat()
        .filter(res => res.status === 'completed' && res.text && res.text.trim().length > 0)
        .map(res => ({
          providerId: res.providerId,
          text: res.text
        }));

      console.log(`[WorkflowEngine] Found ${sourceArray.length} historical sources`);
      return sourceArray;

    } else if (payload.sourceStepIds) {
      // Current workflow source
      const sourceArray = [];
      
      for (const stepId of payload.sourceStepIds) {
        const stepResult = previousResults.get(stepId);
        
        if (!stepResult || stepResult.status !== 'completed') {
          console.warn(`[WorkflowEngine] Step ${stepId} not found or incomplete`);
          continue;
        }

        const { results } = stepResult.result;
        
        Object.entries(results).forEach(([providerId, result]) => {
          if (result.status === 'completed' && result.text && result.text.trim().length > 0) {
            sourceArray.push({
              providerId: providerId,
              text: result.text
            });
          }
        });
      }

      console.log(`[WorkflowEngine] Found ${sourceArray.length} current workflow sources`);
      return sourceArray;
    }
    
    throw new Error('No valid source specified for step.');
  }

  /**
   * UPDATED: Execute synthesis step with ResolvedContext
   */
  async executeSynthesisStep(step, context, previousResults, workflowContexts, resolvedContext) {
    const payload = step.payload;
    const sourceData = await this.resolveSourceData(payload, context, previousResults, resolvedContext);
    
    if (sourceData.length === 0) {
      throw new Error("No valid sources for synthesis.");
    }

    // Look for mapping results
    let mappingResult = null;
    if (payload.mappingStepIds && payload.mappingStepIds.length > 0) {
      for (const mappingStepId of payload.mappingStepIds) {
        const mappingStepResult = previousResults.get(mappingStepId);
        if (mappingStepResult?.status === 'completed' && mappingStepResult.result?.text) {
          mappingResult = mappingStepResult.result;
          break;
        }
      }
    }

    const synthPrompt = buildSynthesisPrompt(
      payload.originalPrompt, 
      sourceData, 
      payload.synthesisProvider,
      mappingResult
    );

    // Resolve provider context using three-tier resolution
    const providerContexts = this._resolveProviderContext(
      payload.synthesisProvider, 
      context, 
      payload, 
      workflowContexts, 
      previousResults,
      resolvedContext,
      'Synthesis'
    );

    return new Promise((resolve, reject) => {
      this.orchestrator.executeParallelFanout(synthPrompt, [payload.synthesisProvider], {
        sessionId: context.sessionId,
        useThinking: payload.useThinking,
        providerContexts: Object.keys(providerContexts).length ? providerContexts : undefined,
        providerMeta: step?.payload?.providerMeta,
        onPartial: (providerId, chunk) => {
          const delta = makeDelta(context.sessionId, providerId, chunk.text);
          if (delta && delta.length > 0) {
            this.port.postMessage({ 
              type: 'PARTIAL_RESULT', 
              sessionId: context.sessionId, 
              stepId: step.stepId, 
              providerId, 
              chunk: { text: delta } 
            });
            logger.stream('Synthesis delta:', { stepId: step.stepId, providerId, len: delta.length });
          }
        },
        onAllComplete: (results) => {
          const finalResult = results.get(payload.synthesisProvider);
          
          if (finalResult?.text) {
            const delta = makeDelta(context.sessionId, payload.synthesisProvider, finalResult.text);
            if (delta && delta.length > 0) {
              this.port.postMessage({  
                type: 'PARTIAL_RESULT',  
                sessionId: context.sessionId,  
                stepId: step.stepId,  
                providerId: payload.synthesisProvider,  
                chunk: { text: delta, isFinal: true }  
              }); 
            }
          }
          
          if (!finalResult || !finalResult.text) {
            reject(new Error(`Synthesis provider ${payload.synthesisProvider} returned empty response`));
            return;
          }

          this.sessionManager.updateProviderContext(
            context.sessionId, 
            payload.synthesisProvider, 
            finalResult, 
            true, 
            { skipSave: true }
          );
          this.sessionManager.saveSession(context.sessionId);

          if (finalResult?.meta) {
            workflowContexts[payload.synthesisProvider] = finalResult.meta;
          }
          
          resolve({
            providerId: payload.synthesisProvider,
            text: finalResult.text,
            status: 'completed',
            meta: finalResult.meta || {}
          });
        }
      });
    });
  }

  /**
   * UPDATED: Execute mapping step with ResolvedContext
   */
  async executeMappingStep(step, context, previousResults, workflowContexts, resolvedContext) {
    const payload = step.payload;
    const sourceData = await this.resolveSourceData(payload, context, previousResults, resolvedContext);
    
    if (sourceData.length === 0) {
      throw new Error("No valid sources for mapping.");
    }

    const mappingPrompt = buildMappingPrompt(payload.originalPrompt, sourceData);

    const providerContexts = this._resolveProviderContext(
      payload.mappingProvider, 
      context, 
      payload, 
      workflowContexts, 
      previousResults,
      resolvedContext,
      'Mapping'
    );

    return new Promise((resolve, reject) => {
      this.orchestrator.executeParallelFanout(mappingPrompt, [payload.mappingProvider], {
        sessionId: context.sessionId,
        useThinking: payload.useThinking,
        providerContexts: Object.keys(providerContexts).length ? providerContexts : undefined,
        providerMeta: step?.payload?.providerMeta,
        onPartial: (providerId, chunk) => {
          const delta = makeDelta(context.sessionId, providerId, chunk.text);
          if (delta && delta.length > 0) {
            this.port.postMessage({ 
              type: 'PARTIAL_RESULT', 
              sessionId: context.sessionId, 
              stepId: step.stepId, 
              providerId, 
              chunk: { text: delta } 
            });
            logger.stream('Mapping delta:', { stepId: step.stepId, providerId, len: delta.length });
          }
        },
        onAllComplete: (results) => {
          const finalResult = results.get(payload.mappingProvider);
          
          if (finalResult?.text) {
            const delta = makeDelta(context.sessionId, payload.mappingProvider, finalResult.text);
            if (delta && delta.length > 0) {
              this.port.postMessage({  
                type: 'PARTIAL_RESULT',  
                sessionId: context.sessionId,  
                stepId: step.stepId,  
                providerId: payload.mappingProvider,  
                chunk: { text: delta, isFinal: true }  
              }); 
            }
          }
          
          if (!finalResult || !finalResult.text) {
            reject(new Error(`Mapping provider ${payload.mappingProvider} returned empty response`));
            return;
          }

          this.sessionManager.updateProviderContext(
            context.sessionId, 
            payload.mappingProvider, 
            finalResult, 
            true, 
            { skipSave: true }
          );
          this.sessionManager.saveSession(context.sessionId);

          if (finalResult?.meta) {
            workflowContexts[payload.mappingProvider] = finalResult.meta;
          }
          
          resolve({
            providerId: payload.mappingProvider,
            text: finalResult.text,
            status: 'completed',
            meta: finalResult.meta || {}
          });
        }
      });
    });
  }

  /**
   * UPDATED: Three-tier context resolution with ResolvedContext support
   */
  _resolveProviderContext(providerId, context, payload, workflowContexts, previousResults, resolvedContext, stepType = 'step') {
    const providerContexts = {};

    // TIER 1: Workflow cache (highest priority)
    if (workflowContexts && workflowContexts[providerId]) {
      providerContexts[providerId] = {
        meta: workflowContexts[providerId],
        continueThread: true
      };
      console.log(`[WorkflowEngine] ${stepType} using workflow-cached context for ${providerId}`);
      return providerContexts;
    }

    // TIER 2: ResolvedContext (for recompute - historical contexts)
    if (resolvedContext && resolvedContext.type === 'recompute') {
      const historicalContext = resolvedContext.providerContextsAtSourceTurn?.[providerId];
      if (historicalContext) {
        providerContexts[providerId] = {
          meta: historicalContext,
          continueThread: true
        };
        console.log(`[WorkflowEngine] ${stepType} using historical context from ResolvedContext for ${providerId}`);
        return providerContexts;
      }
    }

    // TIER 3: Batch step context (backward compat)
    if (payload.continueFromBatchStep) {
      const batchResult = previousResults.get(payload.continueFromBatchStep);
      if (batchResult?.status === 'completed' && batchResult.result?.results) {
        const providerResult = batchResult.result.results[providerId];
        if (providerResult?.meta) {
          providerContexts[providerId] = {
            meta: providerResult.meta,
            continueThread: true
          };
          console.log(`[WorkflowEngine] ${stepType} continuing conversation for ${providerId} via batch step`);
          return providerContexts;
        }
      }
    }

    // TIER 4: Persisted context (last resort)
    try {
      const persisted = this.sessionManager.getProviderContexts(context.sessionId, context.threadId || 'default-thread');
      const persistedMeta = persisted?.[providerId]?.meta;
      if (persistedMeta && Object.keys(persistedMeta).length > 0) {
        providerContexts[providerId] = {
          meta: persistedMeta,
          continueThread: true
        };
        console.log(`[WorkflowEngine] ${stepType} using persisted context for ${providerId}`);
        return providerContexts;
      }
    } catch (_) {}

    return providerContexts;
  }

  // ... (persistence methods continued in original - unchanged)
