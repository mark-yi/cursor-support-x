import type { AppConfig } from "./config.ts";
import type { MentionState, SupportMention } from "./types.ts";
import { readJsonFile, writeJsonFile } from "./utils/fs.ts";

const EMPTY_STATE: MentionState = {
  lastSeenMentionId: null,
  processedMentionIds: [],
  updatedAt: null
};

export async function loadMentionState(config: AppConfig): Promise<MentionState> {
  return readJsonFile<MentionState>(config.mentionsStateFile, EMPTY_STATE);
}

export async function saveMentionState(config: AppConfig, state: MentionState): Promise<void> {
  await writeJsonFile(config.mentionsStateFile, {
    ...state,
    processedMentionIds: state.processedMentionIds.slice(-500),
    updatedAt: new Date().toISOString()
  });
}

export function applyProcessedMentions(state: MentionState, mentions: SupportMention[]): MentionState {
  const processedMentionIds = new Set(state.processedMentionIds);
  for (const mention of mentions) {
    processedMentionIds.add(mention.id);
  }

  const highestMentionId = mentions
    .map((mention) => mention.id)
    .sort((left, right) => Number(left) - Number(right))
    .at(-1);

  return {
    lastSeenMentionId: highestMentionId || state.lastSeenMentionId,
    processedMentionIds: Array.from(processedMentionIds).slice(-500),
    updatedAt: new Date().toISOString()
  };
}
