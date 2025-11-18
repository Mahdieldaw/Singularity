import React from "react";
import { useAtom } from "jotai";
import CompactModelTray from "./CompactModelTray";
import {
  selectedModelsAtom,
  mappingEnabledAtom,
  mappingProviderAtom,
  synthesisProviderAtom,
  synthesisProvidersAtom,
  powerUserModeAtom,
  thinkOnChatGPTAtom,
  chatInputHeightAtom,
  isFirstTurnAtom,
  isLoadingAtom,
  refineModelAtom,
  isHistoryPanelOpenAtom,
} from "../state/atoms";

const CompactModelTrayConnected = () => {
  const [selectedModels, setSelectedModels] = useAtom(selectedModelsAtom);
  const [mappingEnabled, setMappingEnabled] = useAtom(mappingEnabledAtom);
  const [mappingProvider, setMappingProvider] = useAtom(mappingProviderAtom);
  const [synthesisProvider, setSynthesisProvider] = useAtom(
    synthesisProviderAtom,
  );
  const [synthesisProviders, setSynthesisProviders] = useAtom(
    synthesisProvidersAtom,
  );
  const [powerUserMode] = useAtom(powerUserModeAtom);
  const [thinkOnChatGPT, setThinkOnChatGPT] = useAtom(thinkOnChatGPTAtom);
  const [chatInputHeight] = useAtom(chatInputHeightAtom);
  const [isFirstLoad] = useAtom(isFirstTurnAtom);
  const [isLoading] = useAtom(isLoadingAtom);
  const [refineModel, setRefineModel] = useAtom(refineModelAtom);
  const [isHistoryOpen] = useAtom(isHistoryPanelOpenAtom);

  // ✅ FIX: Proper immutable updates (no draft mutation)
  const handleToggleModel = (providerId: string) => {
    setSelectedModels((prev) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }));
  };

  const handleToggleMapping = (enabled: boolean) => {
    setMappingEnabled(enabled);
    // Persist immediately
    try {
      localStorage.setItem("htos_mapping_enabled", JSON.stringify(enabled));
    } catch {}
  };

  const handleSetMappingProvider = (providerId: string | null) => {
    setMappingProvider(providerId);
    // Persist immediately
    try {
      if (providerId) {
        localStorage.setItem("htos_mapping_provider", providerId);
      } else {
        localStorage.removeItem("htos_mapping_provider");
      }
    } catch {}
  };

  const handleSetSynthesisProvider = (providerId: string | null) => {
    setSynthesisProvider(providerId);
    // Persist immediately
    try {
      if (providerId) {
        localStorage.setItem("htos_synthesis_provider", providerId);
      } else {
        localStorage.removeItem("htos_synthesis_provider");
      }
    } catch {}
  };

  // ✅ CORRECT: Immutable array update
  const handleToggleSynthesisProvider = (providerId: string) => {
    setSynthesisProviders((prev) => {
      if (prev.includes(providerId)) {
        return prev.filter((id) => id !== providerId);
      } else {
        return [...prev, providerId];
      }
    });
  };

  const handleToggleThinkChatGPT = () => {
    setThinkOnChatGPT((prev) => !prev);
  };

  const handleSetRefineModel = (model: string) => {
    setRefineModel(model);
    try {
      localStorage.setItem('htos_refine_model', model);
    } catch {}
  };

  return (
    <CompactModelTray
      selectedModels={selectedModels}
      onToggleModel={handleToggleModel}
      isLoading={isLoading}
      thinkOnChatGPT={thinkOnChatGPT}
      onToggleThinkChatGPT={handleToggleThinkChatGPT}
      synthesisProvider={synthesisProvider}
      onSetSynthesisProvider={handleSetSynthesisProvider}
      mappingEnabled={mappingEnabled}
      onToggleMapping={handleToggleMapping}
      mappingProvider={mappingProvider}
      onSetMappingProvider={handleSetMappingProvider}
      powerUserMode={powerUserMode}
      synthesisProviders={synthesisProviders}
      onToggleSynthesisProvider={handleToggleSynthesisProvider}
      isFirstLoad={isFirstLoad}
      onAcknowledgeFirstLoad={() => {
        try {
          localStorage.setItem("htos_has_used", "true");
        } catch {}
      }}
      chatInputHeight={chatInputHeight}
      refineModel={refineModel}
      onSetRefineModel={handleSetRefineModel}
      isHistoryPanelOpen={!!isHistoryOpen}
    />
  );
};

export default CompactModelTrayConnected;
