import type { ChatOptions, Message } from '../types.js';
import { PAIError } from '../types.js';
import { PAIError as LibPAIError } from '../lib/types.js';
import { loadConfig, resolveProvider } from '../lib/config.js';
import { chat } from '../lib/chat.js';
import type { ChatInput, ChatConfig } from '../lib/types.js';
import { SessionManager } from '../session-manager.js';
import { InputResolver } from '../input-resolver.js';
import { OutputFormatter } from '../output-formatter.js';
import { ToolRegistry } from '../tool-registry.js';
import { resolveModel } from '../lib/model-resolver.js';

/**
 * Handle the chat command
 */
export async function handleChatCommand(
  prompt: string | undefined,
  options: ChatOptions
): Promise<void> {
  // Initialize CLI components
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

    // Load configuration and resolve provider using lib/ layer
    const config = await loadConfig(options.config);
    const { provider, apiKey } = await resolveProvider(config, options.provider);

    // Resolve model from provider config + CLI options
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

    // --dry-run: show resolved config and exit
    if (options.dryRun) {
      const configPath =
        options.config ||
        process.env['PAI_CONFIG'] ||
        `~/.config/pai/default.json`;
      const info = {
        provider: provider.name,
        model: modelName,
        configFile: configPath,
        temperature: resolved.temperature,
        maxTokens: resolved.maxTokens,
        stream: options.stream ?? false,
        credentialSource: 'resolved',
      };
      process.stderr.write(JSON.stringify(info, null, 2) + '\n');
      return;
    }

    // Load session history
    const sessionMessages: Message[] = await sessionManager.loadMessages();
    const loadedMessageCount = sessionMessages.length;

    // Resolve system instruction
    const systemInstruction = await inputResolver.resolveSystemInput(
      options.system,
      options.systemFile
    );

    // Build history: session messages minus any leading system message
    // (system is passed separately to ChatInput)
    let history: Message[] = [...sessionMessages];
    let hadSystemInSession = false;

    if (systemInstruction) {
      if (history.length > 0 && history[0]?.role === 'system') {
        // Replace existing system message in history
        history[0] = { role: 'system', content: systemInstruction };
        hadSystemInSession = true;
      }
      await outputFormatter.logSystemMessage(systemInstruction);
    }

    // Resolve user input
    const hasExplicitInput = prompt !== undefined || options.inputFile !== undefined;
    const stdinAvailable = !process.stdin.isTTY && !hasExplicitInput;
    const userInput = await inputResolver.resolveUserInput({
      message: prompt,
      stdin: stdinAvailable,
      file: options.inputFile,
      images: options.image,
    });

    // If the last loaded message was a user message, replace it (already in session file)
    const lastLoadedIsUser =
      loadedMessageCount > 0 && sessionMessages[sessionMessages.length - 1]?.role === 'user';
    if (lastLoadedIsUser) {
      history[history.length - 1] = { role: 'user', content: userInput };
    }

    await outputFormatter.logUserMessage(
      typeof userInput === 'string' ? userInput : JSON.stringify(userInput)
    );

    await outputFormatter.logRequestSummary({
      provider: provider.name,
      model: modelName,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      stream: options.stream,
    });

    // Build ChatInput
    // history passed to lib/chat should NOT include the current user message
    // (lib/chat appends userMessage itself)
    // We need to separate: history = everything except the current user turn
    let chatHistory: Message[];
    if (lastLoadedIsUser) {
      // The last message in history was replaced with current user input above,
      // but lib/chat will add userMessage itself — so exclude it from history
      chatHistory = history.slice(0, -1);
    } else {
      chatHistory = history;
    }

    // Extract system from history if present (lib/chat takes system separately)
    let chatSystem: string | undefined;
    if (systemInstruction) {
      chatSystem = systemInstruction;
      // Remove system message from chatHistory if it's there
      if (chatHistory.length > 0 && chatHistory[0]?.role === 'system') {
        chatHistory = chatHistory.slice(1);
      }
    } else if (chatHistory.length > 0 && chatHistory[0]?.role === 'system') {
      // Use existing system message from session
      const sysContent = chatHistory[0].content;
      chatSystem = typeof sysContent === 'string' ? sysContent : JSON.stringify(sysContent);
      chatHistory = chatHistory.slice(1);
    }

    const chatInput: ChatInput = {
      ...(chatSystem !== undefined && { system: chatSystem }),
      userMessage: userInput,
      ...(chatHistory.length > 0 && { history: chatHistory }),
    };

    // Build ChatConfig from provider config + CLI options
    // Use spread to avoid setting undefined on exactOptionalPropertyTypes
    const chatConfig: ChatConfig = {
      provider: provider.name,
      model: modelName,
      apiKey,
      ...(options.stream !== undefined && { stream: options.stream }),
      ...(resolved.temperature !== undefined && { temperature: resolved.temperature }),
      ...(resolved.maxTokens !== undefined && { maxTokens: resolved.maxTokens }),
      ...(provider.api !== undefined && { api: provider.api }),
      ...(provider.baseUrl !== undefined && { baseUrl: provider.baseUrl }),
      ...(provider.reasoning !== undefined && { reasoning: provider.reasoning }),
      ...(resolved.contextWindow !== undefined && { contextWindow: resolved.contextWindow }),
      ...(provider.providerOptions !== undefined && { providerOptions: provider.providerOptions }),
    };

    // Get all tools
    const tools = toolRegistry.getAll();

    // Compute content lengths for diagnostics (for writeProgress start event)
    const systemChars = chatSystem ? chatSystem.length : 0;
    const userChars =
      typeof userInput === 'string'
        ? userInput.length
        : JSON.stringify(userInput).length;

    // Call lib/chat and consume ChatEvent stream
    for await (const event of chat(
      chatInput,
      chatConfig,
      process.stdout,
      tools,
      abortController.signal,
      options.maxTurns,
    )) {
      switch (event.type) {
        case 'start':
          outputFormatter.writeProgress({
            type: 'start',
            data: {
              provider: event.provider,
              model: event.model,
              stream: options.stream ?? false,
              messages: event.messageCount,
              systemChars,
              userChars,
              tools: event.toolCount,
            },
          });
          break;

        case 'complete':
          outputFormatter.writeProgress({
            type: 'complete',
            data: {
              finishReason: event.finishReason,
              usage: event.usage,
            },
          });
          break;

        case 'tool_call':
          outputFormatter.writeProgress({
            type: 'tool_call',
            data: { name: event.name, arguments: event.args },
          });
          await outputFormatter.logToolCall(event.name, event.args);
          break;

        case 'tool_result':
          outputFormatter.writeProgress({
            type: 'tool_result',
            data: event.result,
          });
          await outputFormatter.logToolResult(event.name, event.result);
          break;

        case 'chat_end': {
          // Determine which new messages to append to session
          // We need to include: system (if new), user message, and all assistant/tool messages
          const newMessages: Message[] = [];

          if (systemInstruction && !hadSystemInSession) {
            newMessages.push({ role: 'system', content: systemInstruction });
          }

          if (!lastLoadedIsUser) {
            newMessages.push({ role: 'user', content: userInput });
          }

          // Add all messages from chat_end (assistant + tool messages)
          newMessages.push(...(event.newMessages as Message[]));

          // Log assistant message(s) to log file
          for (const msg of event.newMessages) {
            if (msg.role === 'assistant') {
              const assistantContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
              await outputFormatter.logAssistantMessage(assistantContent);
            }
          }

          // Save session if not disabled
          if (options.append !== false && sessionManager.getSessionPath()) {
            await sessionManager.appendMessages(newMessages);
          }
          break;
        }

        // thinking events - no CLI output needed
        case 'thinking_start':
        case 'thinking_delta':
        case 'thinking_end':
          break;
      }
    }

    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);

  } catch (error) {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);

    if (error instanceof PAIError || error instanceof LibPAIError) {
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
