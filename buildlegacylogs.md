9 results - 4 files

src\sw-entry.js:
  489            const sessionId = message.sessionId || message.payload?.sessionId;
  490            if (!sessionId) {
  491              console.error('[SW] GET_HISTORY_SESSION missing sessionId in message:', message);
  492              sendResponse({ success: false, error: 'Missing sessionId' });
  493              return true;
  494            }
  495  
  496            let session = sm.sessions?.[sessionId];
  497            if (!session && sm.getPersistenceStatus?.().usePersistenceAdapter && sm.adapter?.isReady()) {
  498              // Hydrate from persistence
  499:             session = await sm.buildLegacySessionObject(sessionId);
  500              if (session) {
  501                sm.sessions[sessionId] = session;
  502              }
  503            }
  504  
  505            if (session) {
  506              // Build "rounds" the UI expects: { createdAt, userTurnId, aiTurnId, user: {id?, text, createdAt}, providers: {...}, completedAt }
  507              const turns = Array.isArray(session.turns) ? session.turns : [];
  508              const rounds = [];
  509              for (let i = 0; i < turns.length; i++) {

src\core\workflow-engine.js:
  1217                  break;
  1218                }
  1219              }
  1220            }
  1221            if (aiTurn && aiTurn.type === 'ai') {
  1222              let maps = aiTurn.mappingResponses || {};
  1223              // Fallback: if maps look empty, rehydrate session from persistence and retry
  1224              if (!maps || Object.keys(maps).length === 0) {
  1225                try {
  1226                  if (this.sessionManager.adapter?.isReady && this.sessionManager.adapter.isReady()) {
  1227:                   const rebuilt = await this.sessionManager.buildLegacySessionObject(session.sessionId || context.sessionId);
  1228                    if (rebuilt) {
  1229                      this.sessionManager.sessions[rebuilt.sessionId] = rebuilt;
  1230                      const refreshedTurns = Array.isArray(rebuilt.turns) ? rebuilt.turns : [];
  1231                      const idx2 = refreshedTurns.findIndex(t => t && t.id === userTurnId && (t.type === 'user' || t.role === 'user'));
  1232                      if (idx2 !== -1 && refreshedTurns[idx2 + 1] && (refreshedTurns[idx2 + 1].type === 'ai' || refreshedTurns[idx2 + 1].role === 'assistant')) {
  1233                        const refreshedAi = refreshedTurns[idx2 + 1];
  1234                        maps = refreshedAi.mappingResponses || {};
  1235                        console.log('[WorkflowEngine] Rehydrated session from persistence for historical mapping lookup');
  1236                      }
  1237                    }

src\persistence\SessionManager.d.ts:
  47    usePersistenceAdapter: boolean;
  48    adapter: any;
  49    isInitialized: boolean;
  50  
  51    constructor();
  52    
  53    initialize(config?: { adapter?: any; usePersistenceAdapter?: boolean; initTimeoutMs?: number }): Promise<void>;
  54    
  55    getOrCreateSession(sessionId: string): Promise<SessionData>;
  56    getOrCreateSessionWithPersistence(sessionId: string): Promise<SessionData>;
  57:   buildLegacySessionObject(sessionId: string): Promise<SessionData>;
  58    
  59    saveSession(sessionId: string): Promise<void>;
  60    saveSessionWithPersistence(sessionId: string): Promise<void>;
  61    
  62    addTurn(sessionId: string, userTurn: any, aiTurn: any, threadId?: string): Promise<void>;
  63    addTurnWithPersistence(sessionId: string, userTurn: any, aiTurn: any, threadId?: string): Promise<void>;
  64    
  65    deleteSession(sessionId: string): Promise<void>;
  66    deleteSessionWithPersistence(sessionId: string): Promise<void>;
  67    

src\persistence\SessionManager.js:
  117  
  118      // 5) Provider responses
  119      await this._persistProviderResponses(sessionId, aiTurnId, result, now);
  120  
  121      // 6) Update session lastTurnId
  122      sessionRecord.lastTurnId = aiTurnId;
  123      sessionRecord.updatedAt = now;
  124      await this.adapter.put('sessions', sessionRecord);
  125  
  126      // 7) Update legacy cache
  127:     const legacySession = await this.buildLegacySessionObject(sessionId);
  128      if (legacySession) this.sessions[sessionId] = legacySession;
  129  
  130      return { sessionId, userTurnId, aiTurnId };
  131    }
  132  
  133    /**
  134     * Extend: Append turn to existing session
  135     */
  136    async _persistExtend(request, context, result) {
  137      const { sessionId } = request;

  194      const session = await this.adapter.get('sessions', sessionId);
  195      if (session) {
  196        session.lastTurnId = aiTurnId;
  197        session.lastActivity = now;
  198        session.turnCount = (session.turnCount || 0) + 2;
  199        session.updatedAt = now;
  200        await this.adapter.put('sessions', session);
  201      }
  202  
  203      // 6) Update legacy cache
  204:     const legacySession = await this.buildLegacySessionObject(sessionId);
  205      if (legacySession) this.sessions[sessionId] = legacySession;
  206  
  207      return { sessionId, userTurnId, aiTurnId };
  208    }
  209  
  210    /**
  211     * Recompute: Create derived turn (timeline branch)
  212     */
  213    async _persistRecompute(request, context, result) {
  214      const { sessionId, sourceTurnId, stepType, targetProvider } = request;

  256          updatedAt: now,
  257          completedAt: now
  258        });
  259      } else {
  260        console.warn(`[SessionManager] No ${stepType} output found for ${targetProvider}`);
  261      }
  262  
  263      // 4) Do NOT update session.lastTurnId (branch)
  264  
  265      // 5) Update legacy cache
  266:     const legacySession = await this.buildLegacySessionObject(sessionId);
  267      if (legacySession) this.sessions[sessionId] = legacySession;
  268  
  269      return { sessionId, aiTurnId };
  270    }
  271  
  272    /**
  273     * Extract provider contexts from workflow result
  274     */
  275    _extractContextsFromResult(result) {
  276      const contexts = {};

  705            title: 'Main Thread',
  706            isActive: true,
  707            createdAt: Date.now(),
  708            updatedAt: Date.now()
  709          };
  710          
  711          await this.adapter.put('threads', defaultThread);
  712        }
  713        
  714        // Build legacy-compatible session object for backward compatibility
  715:       const legacySession = await this.buildLegacySessionObject(sessionId);
  716        // 3. Store in cache for next time
  717        if (legacySession) {
  718          this.sessions[sessionId] = legacySession;
  719        }
  720        
  721        return legacySession;
  722      } catch (error) {
  723        console.error(`[SessionManager] Failed to get/create session ${sessionId}:`, error);
  724        return null;
  725      }
  726    }
  727  
  728  
  729    /**
  730     * Build legacy-compatible session object from persistence layer
  731     */
  732:   async buildLegacySessionObject(sessionId) {
  733      try {
  734        console.log(`[SessionManager] Building legacy session for ${sessionId}`);
  735        const sessionRecord = await this.adapter.get('sessions', sessionId);
  736        if (!sessionRecord) {
  737          console.log(`[SessionManager] Session record not found for ${sessionId}`);
  738          return null;
  739        }
  740  
  741        // Get threads
  742        const allThreads = await this.adapter.getAll('threads');

  857            const ta = (a.updatedAt ?? a.createdAt ?? 0);
  858            const tb = (b.updatedAt ?? b.createdAt ?? 0);
  859            return tb - ta; // newest first
  860          });
  861          const selected = sorted[0];
  862          providersObj[pid] = {
  863            ...selected.contextData,
  864            lastUpdated: selected.updatedAt
  865          };
  866          if (arr.length > 1) {
  867:           console.log(`[SessionManager] buildLegacySessionObject: resolved ${arr.length} contexts for provider ${pid}, selected ${selected.id} (updatedAt=${selected.updatedAt})`);
  868          }
  869        });
  870  
  871        const legacySession = {
  872          sessionId: sessionRecord.id,
  873          providers: providersObj,
  874          contextHistory: [],
  875          createdAt: sessionRecord.createdAt,
  876          lastActivity: sessionRecord.updatedAt,
  877          title: sessionRecord.title,
