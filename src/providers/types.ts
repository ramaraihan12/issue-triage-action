import type { Prompt } from '../prompt';

export interface ChatModel {
  // provider:model, used in logs
  readonly id: string;
  complete(prompt: Prompt): Promise<string>;
}
