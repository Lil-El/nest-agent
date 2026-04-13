export const AI_TTS_STREAM_EVENT = "ai.tts.stream";

export type AiTtsStreamEvent =
  | { type: "start"; sessionId: string; messageId: string }
  | { type: "end"; sessionId: string; messageId: string }
  | { type: "chunk"; sessionId: string; messageId: string; chunk: string };
