import type { Writable } from 'node:stream';
import type { ChatInput, ChatConfig, ChatEvent, Message, Tool } from './types.js';
import { PAIError, ExitCode } from './types.js';
import { LLMClient } from './llm-client.js';

const DEFAULT_MAX_TURNS = 100;

/**
 * Core chat function - implements multi-turn LLM conversation with tool calling.
 * Returns an AsyncGenerator of ChatEvent for progress tracking.
 * Streaming chunks are written to chunkWriter (if non-null).
 */
export async function* chat(
  input: ChatInput,
  config: ChatConfig,
  chunkWriter: Writable | null,
  tools: Tool[],
  signal: AbortSignal,
  maxTurns?: number,
): AsyncGenerator<ChatEvent> {
  // Build initial messages array: system + history + userMessage
  const messages: Message[] = [];

  if (input.system) {
    messages.push({ role: 'system', content: input.system });
  }

  if (input.history && input.history.length > 0) {
    messages.push(...input.history);
  }

  messages.push({ role: 'user', content: input.userMessage });

  // Create LLMClient from config
  const llmClient = new LLMClient({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    stream: config.stream,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    api: config.api,
    baseUrl: config.baseUrl,
    reasoning: config.reasoning,
    contextWindow: config.contextWindow,
    providerOptions: config.providerOptions,
  });

  // Track new messages produced in this chat session
  const newMessages: Message[] = [];

  let turnsLeft = maxTurns ?? DEFAULT_MAX_TURNS;
  let continueLoop = true;

  try {
    while (continueLoop && turnsLeft > 0) {
      turnsLeft--;

      // Check abort before each LLM call
      if (signal.aborted) {
        throw new PAIError('Chat aborted by signal', ExitCode.RUNTIME_ERROR);
      }

      // Yield start event
      yield {
        type: 'start',
        provider: config.provider,
        model: config.model,
        messageCount: messages.length,
        toolCount: tools.length,
      };

      let assistantMessage: Message;
      let finishReason = 'unknown';
      let usage: { input: number; output: number; cost?: { total: number } } | undefined;
      const toolCallsCollected: Array<{ id: string; name: string; arguments: unknown }> = [];

      if (config.stream) {
        // Streaming mode
        let fullContent = '';

        for await (const response of llmClient.chat(messages, tools)) {
          if (response.finishReason === 'streaming') {
            // Streaming chunk
            if (response.content && chunkWriter !== null) {
              chunkWriter.write(response.content);
            }
            fullContent += response.content;
          } else {
            // Final response
            finishReason = response.finishReason;
            usage = response.usage;
            if (response.toolCalls) {
              toolCallsCollected.push(...response.toolCalls);
            }
          }
        }

        const streamMsg: Message & { tool_calls?: typeof toolCallsCollected } =
          { role: 'assistant', content: fullContent };
        if (toolCallsCollected.length > 0) streamMsg.tool_calls = toolCallsCollected;
        assistantMessage = streamMsg;
      } else {
        // Non-streaming mode
        const response = await llmClient.chatComplete(messages, tools);
        finishReason = response.finishReason;
        usage = response.usage;

        if (chunkWriter !== null && response.content) {
          chunkWriter.write(response.content);
        }

        if (response.toolCalls) {
          toolCallsCollected.push(...response.toolCalls);
        }

        const nonStreamMsg: Message & { tool_calls?: typeof toolCallsCollected } =
          { role: 'assistant', content: response.content };
        if (toolCallsCollected.length > 0) nonStreamMsg.tool_calls = toolCallsCollected;
        assistantMessage = nonStreamMsg;
      }

      messages.push(assistantMessage);
      newMessages.push(assistantMessage);

      // Yield complete event
      const completeEvent: ChatEvent = usage
        ? { type: 'complete', finishReason, usage }
        : { type: 'complete', finishReason };
      yield completeEvent;

      // Handle tool calls
      if (toolCallsCollected.length > 0) {
        for (const toolCall of toolCallsCollected) {
          yield {
            type: 'tool_call',
            callId: toolCall.id,
            name: toolCall.name,
            args: toolCall.arguments,
          };

          let result: unknown;
          try {
            // Check abort before executing tool
            if (signal.aborted) {
              throw new PAIError('Chat aborted by signal', ExitCode.RUNTIME_ERROR);
            }

            const tool = tools.find(t => t.name === toolCall.name);
            if (!tool) {
              result = { error: `Error: Tool '${toolCall.name}' not found` };
            } else {
              result = await tool.handler(toolCall.arguments, signal);
            }
          } catch (err) {
            if (err instanceof PAIError) throw err;
            result = { error: err instanceof Error ? err.message : String(err) };
          }

          yield {
            type: 'tool_result',
            callId: toolCall.id,
            name: toolCall.name,
            result,
          };

          const toolResultMessage: Message = {
            role: 'tool',
            name: toolCall.name,
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          };
          messages.push(toolResultMessage);
          newMessages.push(toolResultMessage);
        }

        // Continue loop to get model response after tool execution
        continueLoop = true;
      } else {
        // No tool calls - conversation complete
        continueLoop = false;
      }
    }
  } catch (err) {
    if (err instanceof PAIError) throw err;
    throw new PAIError(
      err instanceof Error ? err.message : String(err),
      ExitCode.API_ERROR,
      { originalError: String(err) },
    );
  }

  yield { type: 'chat_end', newMessages };
}
