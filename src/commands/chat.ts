import type { ChatOptions, Message, LLMResponse } from '../types.js';
import { PAIError } from '../types.js';
import { ConfigurationManager } from '../config-manager.js';
import { SessionManager } from '../session-manager.js';
import { InputResolver } from '../input-resolver.js';
import { OutputFormatter } from '../output-formatter.js';
import { LLMClient } from '../llm-client.js';
import { ToolRegistry } from '../tool-registry.js';
import { resolveModel } from '../model-resolver.js';

const DEFAULT_MAX_TURNS = 100; // Prevent infinite loops

/**
 * Handle the chat command
 */
export async function handleChatCommand(
  prompt: string | undefined,
  options: ChatOptions
): Promise<void> {
  // Initialize components
  const configManager = new ConfigurationManager(options);
  const sessionManager = new SessionManager(options.session);
  const inputResolver = new InputResolver();
  const outputFormatter = new OutputFormatter(
    options.json,
    options.quiet,
    options.log
  );

  // AbortController for cancelling in-flight tool calls (e.g. bash_exec process trees)
  const abortController = new AbortController();
  const onSignal = (): void => abortController.abort();
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);

  const toolRegistry = new ToolRegistry();

  try {
    // Validate model parameters
    if (options.temperature !== undefined) {
      if (isNaN(options.temperature) || !isFinite(options.temperature)) {
        throw new PAIError(
          'Invalid temperature value',
          1,
          { temperature: options.temperature, message: 'Temperature must be a finite number' }
        );
      }
      if (options.temperature < 0 || options.temperature > 2) {
        throw new PAIError(
          'Invalid temperature value',
          1,
          { temperature: options.temperature, message: 'Temperature must be between 0 and 2' }
        );
      }
    }

    if (options.maxTokens !== undefined) {
      if (isNaN(options.maxTokens) || !isFinite(options.maxTokens)) {
        throw new PAIError(
          'Invalid maxTokens value',
          1,
          { maxTokens: options.maxTokens, message: 'maxTokens must be a finite number' }
        );
      }
      if (options.maxTokens <= 0) {
        throw new PAIError(
          'Invalid maxTokens value',
          1,
          { maxTokens: options.maxTokens, message: 'maxTokens must be greater than 0' }
        );
      }
    }

    // Load configuration and resolve credentials
    const provider = await configManager.getProvider(options.provider);
    const resolved = resolveModel(provider, {
      ...(options.model !== undefined && { model: options.model }),
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
    });
    const modelName = resolved.model;

    if (!modelName) {
      throw new PAIError(
        'No model specified',
        1,
        { provider: provider.name, message: 'Specify --model or configure a default model' }
      );
    }

    const apiKey = await configManager.resolveCredentials(provider.name, undefined);

    // --dry-run: show resolved config and exit
    if (options.dryRun) {
      const info = {
        provider: provider.name,
        model: modelName,
        configFile: configManager.getConfigPath(),
        temperature: resolved.temperature,
        maxTokens: resolved.maxTokens,
        stream: options.stream ?? false,
        credentialSource: 'resolved',
      };
      process.stderr.write(JSON.stringify(info, null, 2) + '\n');
      return;
    }

    // Initialize LLM client
    const llmClient = new LLMClient({
      provider: provider.name,
      model: modelName,
      apiKey,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      stream: options.stream,
      api: provider.api,
      baseUrl: provider.baseUrl,
      reasoning: provider.reasoning,
      input: provider.input,
      contextWindow: provider.contextWindow,
      providerOptions: provider.providerOptions,
    });

    // Load session history
    const messages: Message[] = await sessionManager.loadMessages();
    const loadedMessageCount = messages.length;

    // Track new messages to append to session file
    const newMessages: Message[] = [];

    // Resolve system instruction
    const systemInstruction = await inputResolver.resolveSystemInput(
      options.system,
      options.systemFile
    );

    // Add or update system message
    if (systemInstruction) {
      if (messages.length > 0 && messages[0]?.role === 'system') {
        // Replace existing system message (already in session file, no need to append)
        messages[0] = { role: 'system', content: systemInstruction };
      } else {
        // Add new system message at the beginning
        const sysMsg: Message = { role: 'system', content: systemInstruction };
        messages.unshift(sysMsg);
        newMessages.push(sysMsg);
      }
      await outputFormatter.logSystemMessage(systemInstruction);
    }

    // Resolve user input
    // Only use stdin if: not a TTY AND no other input source provided
    const hasExplicitInput = prompt !== undefined || options.inputFile !== undefined;
    const stdinAvailable = !process.stdin.isTTY && !hasExplicitInput;
    const userInput = await inputResolver.resolveUserInput({
      message: prompt,
      stdin: stdinAvailable,
      file: options.inputFile,
      images: options.image,
    });

    // Add or update user message
    const userMessage: Message = { role: 'user', content: userInput };
    
    // If the last loaded message was a user message, replace it (already in session file)
    // Otherwise add as new message
    const lastLoadedIsUser = loadedMessageCount > 0 && messages[messages.length - 1]?.role === 'user';
    if (lastLoadedIsUser) {
      messages[messages.length - 1] = userMessage;
    } else {
      messages.push(userMessage);
      newMessages.push(userMessage);
    }

    await outputFormatter.logUserMessage(
      typeof userInput === 'string' ? userInput : JSON.stringify(userInput)
    );

    // Log request summary
    await outputFormatter.logRequestSummary({
      provider: provider.name,
      model: modelName,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      stream: options.stream,
    });

    // Get all tools
    const tools = toolRegistry.getAll();

    // Execute chat with tool calling loop
    let continueLoop = true;
    let maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    const turnsLimit = maxTurns; // remember original for messages
    let finalRoundAttempted = false;

    // Compute content lengths for diagnostics
    const systemMsg = messages.find(m => m.role === 'system');
    const userMsg = [...messages].reverse().find(m => m.role === 'user');
    const systemChars = systemMsg ? String(systemMsg.content).length : 0;
    const userChars = userMsg ? (typeof userMsg.content === 'string' ? userMsg.content.length : JSON.stringify(userMsg.content).length) : 0;

    while (continueLoop && maxTurns > 0) {
      maxTurns--;

      // On the last allowed turn, withhold tools so the model is
      // forced to reply with text instead of requesting more tool calls.
      const isLastTurn = maxTurns === 0;
      const currentTools = isLastTurn ? [] : tools;

      if (isLastTurn) {
        process.stderr.write(
          `[Info] Approaching tool-call turn limit. Requesting final text response from model.\n`
        );
      }

      outputFormatter.writeProgress({ type: 'start', data: {
        provider: provider.name,
        model: modelName,
        stream: options.stream ?? false,
        messages: messages.length,
        systemChars,
        userChars,
        tools: currentTools.length,
      } });

      let assistantMessage: Message;
      let lastResponse: LLMResponse | undefined;

      if (options.stream) {
        // Streaming mode
        let fullContent = '';
        const toolCalls: any[] = [];

        for await (const response of llmClient.chat(messages, currentTools)) {
          if (response.content && response.finishReason === 'streaming') {
            fullContent += response.content;
            outputFormatter.writeModelOutput(response.content);
          }

          if (response.finishReason !== 'streaming') {
            // Final response
            lastResponse = response;
            if (response.toolCalls) {
              toolCalls.push(...response.toolCalls);
            }
          }
        }

        assistantMessage = {
          role: 'assistant',
          content: fullContent,
        };

        // Add tool calls to message if any
        if (toolCalls.length > 0) {
          (assistantMessage as any).tool_calls = toolCalls;
        }
      } else {
        // Non-streaming mode
        const response = await llmClient.chatComplete(messages, currentTools);
        lastResponse = response;
        
        outputFormatter.writeModelOutput(response.content);

        assistantMessage = {
          role: 'assistant',
          content: response.content,
        };

        if (response.toolCalls) {
          (assistantMessage as any).tool_calls = response.toolCalls;
        }
      }

      messages.push(assistantMessage);
      newMessages.push(assistantMessage);

      outputFormatter.writeProgress({ type: 'complete', data: {
        finishReason: lastResponse?.finishReason ?? 'unknown',
        usage: lastResponse?.usage,
      } });

      // Handle tool calls
      const toolCalls = (assistantMessage as any).tool_calls;
      
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          outputFormatter.writeProgress({
            type: 'tool_call',
            data: { name: toolCall.name, arguments: toolCall.arguments },
          });

          await outputFormatter.logToolCall(toolCall.name, toolCall.arguments);

          // If we've exhausted turns, reject remaining tool calls
          // and let the loop exit naturally on the next condition check.
          if (maxTurns <= 0) {
            const rejectContent = `Error: Tool-call turn limit (${turnsLimit}) reached. Please provide a final text summary without further tool calls.`;
            const rejectMessage: Message = {
              role: 'tool',
              name: toolCall.name,
              tool_call_id: toolCall.id,
              content: rejectContent,
            };
            messages.push(rejectMessage);
            newMessages.push(rejectMessage);

            outputFormatter.writeProgress({
              type: 'tool_result',
              data: { error: rejectContent },
            });
            await outputFormatter.logToolResult(toolCall.name, { error: rejectContent });
            continue;
          }

          try {
            const result = await toolRegistry.execute(
              toolCall.name,
              toolCall.arguments,
              abortController.signal,
            );

            const toolResultMessage: Message = {
              role: 'tool',
              name: toolCall.name,
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            };

            messages.push(toolResultMessage);
            newMessages.push(toolResultMessage);

            outputFormatter.writeProgress({
              type: 'tool_result',
              data: result,
            });

            await outputFormatter.logToolResult(toolCall.name, result);
          } catch (error) {
            const errorMessage: Message = {
              role: 'tool',
              name: toolCall.name,
              tool_call_id: toolCall.id,
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            };

            messages.push(errorMessage);
            newMessages.push(errorMessage);

            outputFormatter.writeProgress({
              type: 'tool_result',
              data: { error: String(error) },
            });

            await outputFormatter.logToolResult(toolCall.name, { error: String(error) });
          }
        }

        // If tool calls were rejected due to turn limit, do one
        // final round without tools so the model produces a text reply.
        if (maxTurns <= 0) {
          if (finalRoundAttempted) {
            // Already tried a final round — model keeps returning tool calls.
            // Force exit to prevent infinite loop.
            process.stderr.write(
              `[Warning] Model continues to request tool calls after final round. Stopping.\n`
            );
            continueLoop = false;
          } else {
            finalRoundAttempted = true;
            process.stderr.write(
              `[Warning] Tool-call turn limit (${turnsLimit}) reached. Making one final request for a text summary.\n`
            );
            // Allow one more turn, but tools are already withheld
            // because isLastTurn will be true (maxTurns is 0).
            maxTurns = 1;
          }
        }

        // Continue loop to get model's response after tool execution
        continueLoop = true;
      } else {
        // No tool calls, we're done
        continueLoop = false;
      }
    }

    // Save session if not disabled — only append new messages from this invocation
    // Commander.js parses --no-append as options.append = false
    if (options.append !== false && sessionManager.getSessionPath()) {
      await sessionManager.appendMessages(newMessages);
    }

    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);

  } catch (error) {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);

    if (error instanceof PAIError) {
      await outputFormatter.logError(error);
      outputFormatter.writeError(error);
      process.exit(error.exitCode);
    } else {
      const paiError = new PAIError(
        error instanceof Error ? error.message : String(error),
        2,
        { originalError: String(error) }
      );
      await outputFormatter.logError(paiError);
      outputFormatter.writeError(paiError);
      process.exit(2);
    }
  }
}
