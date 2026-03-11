import type { ChatOptions, Message } from '../types.js';
import { PAIError } from '../types.js';
import { ConfigurationManager } from '../config-manager.js';
import { SessionManager } from '../session-manager.js';
import { InputResolver } from '../input-resolver.js';
import { OutputFormatter } from '../output-formatter.js';
import { LLMClient } from '../llm-client.js';
import { ToolRegistry } from '../tool-registry.js';

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
    const modelName = options.model || provider.defaultModel || provider.models?.[0];

    if (!modelName) {
      throw new PAIError(
        'No model specified',
        1,
        { provider: provider.name, message: 'Specify --model or configure a default model' }
      );
    }

    const apiKey = await configManager.resolveCredentials(provider.name, undefined);

    // Initialize LLM client
    const llmClient = new LLMClient({
      provider: provider.name,
      model: modelName,
      apiKey,
      temperature: options.temperature ?? provider.temperature,
      maxTokens: options.maxTokens ?? provider.maxTokens,
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

    // Resolve system instruction
    const systemInstruction = await inputResolver.resolveSystemInput(
      options.system,
      options.systemFile
    );

    // Add or update system message
    if (systemInstruction) {
      if (messages.length > 0 && messages[0]?.role === 'system') {
        // Replace existing system message
        messages[0] = { role: 'system', content: systemInstruction };
      } else {
        // Add new system message at the beginning
        messages.unshift({ role: 'system', content: systemInstruction });
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
    
    if (messages.length > 0 && messages[messages.length - 1]?.role === 'user') {
      // Replace last user message
      messages[messages.length - 1] = userMessage;
    } else {
      // Add new user message
      messages.push(userMessage);
    }

    await outputFormatter.logUserMessage(
      typeof userInput === 'string' ? userInput : JSON.stringify(userInput)
    );

    // Get all tools
    const tools = toolRegistry.getAll();

    // Execute chat with tool calling loop
    let continueLoop = true;
    let maxIterations = 10; // Prevent infinite loops

    while (continueLoop && maxIterations > 0) {
      maxIterations--;

      outputFormatter.writeProgress({ type: 'start', data: {} });

      let assistantMessage: Message;

      if (options.stream) {
        // Streaming mode
        let fullContent = '';
        const toolCalls: any[] = [];

        for await (const response of llmClient.chat(messages, tools)) {
          if (response.content && response.finishReason === 'streaming') {
            fullContent += response.content;
            outputFormatter.writeModelOutput(response.content);
          }

          if (response.finishReason !== 'streaming') {
            // Final response
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
        const response = await llmClient.chatComplete(messages, tools);
        
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

      outputFormatter.writeProgress({ type: 'complete', data: {} });

      // Handle tool calls
      const toolCalls = (assistantMessage as any).tool_calls;
      
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          outputFormatter.writeProgress({
            type: 'tool_call',
            data: { name: toolCall.name, arguments: toolCall.arguments },
          });

          try {
            const result = await toolRegistry.execute(
              toolCall.name,
              toolCall.arguments
            );

            const toolResultMessage: Message = {
              role: 'tool',
              name: toolCall.name,
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            };

            messages.push(toolResultMessage);

            outputFormatter.writeProgress({
              type: 'tool_result',
              data: result,
            });
          } catch (error) {
            const errorMessage: Message = {
              role: 'tool',
              name: toolCall.name,
              tool_call_id: toolCall.id,
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            };

            messages.push(errorMessage);

            outputFormatter.writeProgress({
              type: 'tool_result',
              data: { error: String(error) },
            });
          }
        }

        // Continue loop to get model's response after tool execution
        continueLoop = true;
      } else {
        // No tool calls, we're done
        continueLoop = false;
      }
    }

    // Save session if not disabled
    // Commander.js parses --no-append as options.append = false
    if (options.append !== false && sessionManager.getSessionPath()) {
      await sessionManager.appendMessages(messages);
    }

  } catch (error) {
    if (error instanceof PAIError) {
      outputFormatter.writeError(error);
      process.exit(error.exitCode);
    } else {
      const paiError = new PAIError(
        error instanceof Error ? error.message : String(error),
        2,
        { originalError: String(error) }
      );
      outputFormatter.writeError(paiError);
      process.exit(2);
    }
  }
}
