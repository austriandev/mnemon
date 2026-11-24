// Public interface of @mnemon/assemblyai: an AssemblyAI implementation of the core's Transcriber.
export {
  type AssemblyAiModel,
  type AssemblyAiTranscriberOptions,
  createAssemblyAiTranscriber,
  TRANSCRIPTION_PRICE_PER_HOUR,
  type TranscriptionUsage,
  transcriptionCostUsd,
} from "./assemblyai-transcriber.ts";
