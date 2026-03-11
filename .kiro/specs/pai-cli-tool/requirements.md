# Requirements Document: PAI CLI Tool

## Introduction

PAI is a Unix-style command-line interface tool for interacting with Large Language Models (LLMs). It wraps the @mariozechner/pi-ai library to provide a streamlined interface for chat interactions, provider configuration management, and session history tracking. The tool follows Unix philosophy principles with support for pipes, standard streams, and machine-parsable output formats.

## Glossary

- **PAI**: The command-line tool being specified
- **Provider**: An LLM service provider (OpenAI, Anthropic, Google, GitHub Copilot, etc.)
- **Session_File**: A JSONL file containing conversation history
- **Config_File**: A JSON file containing provider configurations and default settings
- **Auth_File**: A JSON file containing OAuth credentials (auth.json)
- **bash_exec_Tool**: A built-in tool that allows the LLM to execute shell commands
- **JSONL**: JSON Lines format - one JSON object per line
- **NDJSON**: Newline Delimited JSON - streaming JSON format
- **pi-ai_Library**: The underlying @mariozechner/pi-ai library that PAI wraps

## Requirements

### Requirement 1: Model Provider Listing

**User Story:** As a developer, I want to list available LLM providers and models, so that I can see what options are configured and available for use.

#### Acceptance Criteria

1. WHEN a user executes `pai model list`, THE PAI SHALL display all configured providers from the Config_File
2. WHEN a user executes `pai model list --all`, THE PAI SHALL display all providers supported by pi-ai_Library regardless of configuration status
3. WHEN displaying provider information, THE PAI SHALL show provider name, configured models, and authentication status
4. WHEN no Config_File exists, THE PAI SHALL display an empty configured list and exit with code 0
5. WHEN the Config_File is malformed, THE PAI SHALL output an error message to stderr and exit with code 4

### Requirement 2: Provider Configuration Management

**User Story:** As a developer, I want to add, update, and delete provider configurations, so that I can manage which LLM services I use.

#### Acceptance Criteria

1. WHEN a user executes `pai model config --add` with provider details, THE PAI SHALL add or update the provider configuration in Config_File
2. WHEN a user executes `pai model config --delete` with a provider name, THE PAI SHALL remove that provider from Config_File
3. WHEN adding a configuration, THE PAI SHALL validate that the provider is supported by pi-ai_Library
4. WHEN the Config_File does not exist, THE PAI SHALL create it with schema_version field and the new configuration
5. WHEN configuration operations succeed, THE PAI SHALL exit with code 0
6. WHEN configuration operations fail due to invalid parameters, THE PAI SHALL output an error to stderr and exit with code 1
7. WHEN configuration operations fail due to file IO errors, THE PAI SHALL output an error to stderr and exit with code 4

### Requirement 3: Configuration File Resolution

**User Story:** As a developer, I want flexible configuration file location options, so that I can organize my configurations according to my workflow.

#### Acceptance Criteria

1. WHEN no configuration override is specified, THE PAI SHALL use ~/config/pai/default.json as the Config_File path
2. WHEN the PAI_CONFIG environment variable is set, THE PAI SHALL use that path as the Config_File
3. WHEN the --config flag is provided, THE PAI SHALL use that path as the Config_File
4. WHEN multiple configuration sources are present, THE PAI SHALL prioritize in order: --config flag, PAI_CONFIG environment variable, default path
5. THE Config_File SHALL include a schema_version field for future compatibility

### Requirement 4: Authentication Credential Resolution

**User Story:** As a developer, I want flexible authentication options, so that I can provide credentials in the most convenient way for my environment.

#### Acceptance Criteria

1. WHEN authentication credentials are needed, THE PAI SHALL check CLI parameters first
2. WHEN CLI parameters are not provided, THE PAI SHALL check environment variables
3. WHEN environment variables are not set, THE PAI SHALL check the Config_File
4. WHEN no credentials are found in any source, THE PAI SHALL output an error to stderr and exit with code 1
5. THE PAI SHALL support reading OAuth credentials from auth.json file in pi-ai_Library format
6. WHEN outputting information, THE PAI SHALL NOT include API keys or sensitive authentication data

### Requirement 5: Interactive Chat Command

**User Story:** As a developer, I want to send messages to an LLM and receive responses, so that I can interact with AI models from the command line.

#### Acceptance Criteria

1. WHEN a user executes `pai chat` with a message, THE PAI SHALL send the message to the configured LLM and output the response to stdout
2. WHEN a user provides input via stdin or pipe, THE PAI SHALL read the input and send it as the user message
3. WHEN the --stream flag is set, THE PAI SHALL output the response incrementally as it arrives
4. WHEN the --stream flag is not set, THE PAI SHALL output the complete response after receiving it
5. WHEN the --json flag is set, THE PAI SHALL output progress events as NDJSON to stderr
6. WHEN the --json flag is not set, THE PAI SHALL output human-readable progress information to stderr
7. THE PAI SHALL always output the model response to stdout regardless of --json flag setting
8. WHEN chat operations succeed, THE PAI SHALL exit with code 0
9. WHEN chat operations fail due to API errors, THE PAI SHALL output an error to stderr and exit with code 3

### Requirement 6: Session History Management

**User Story:** As a developer, I want to maintain conversation history across multiple chat invocations, so that I can have contextual multi-turn conversations with LLMs.

#### Acceptance Criteria

1. WHEN the --session flag is provided with a file path, THE PAI SHALL read existing conversation history from that Session_File
2. WHEN a Session_File does not exist, THE PAI SHALL create it upon first message
3. WHEN appending to a Session_File, THE PAI SHALL write one JSON object per line in JSONL format
4. WHEN writing to a Session_File, THE PAI SHALL include message role (system, user, assistant, tool) and content
5. WHEN a Session_File exists and new system instructions are provided, THE PAI SHALL append the new system message
6. WHEN a Session_File exists and new user input is provided, THE PAI SHALL append the new user message
7. WHEN reading a malformed Session_File, THE PAI SHALL output an error to stderr and exit with code 4
8. THE Session_File format SHALL support multimodal content (string, object, or array content types)

### Requirement 7: System Instructions Configuration

**User Story:** As a developer, I want to provide system instructions to guide the LLM's behavior, so that I can customize how the model responds.

#### Acceptance Criteria

1. WHEN the --system flag is provided with text, THE PAI SHALL send that text as a system message
2. WHEN the --system-file flag is provided with a file path, THE PAI SHALL read the file content and send it as a system message
3. WHEN both --system and --system-file are provided, THE PAI SHALL output an error to stderr and exit with code 1
4. WHEN a Session_File exists with system messages, THE PAI SHALL include those in the conversation context
5. WHEN reading a system instruction file fails, THE PAI SHALL output an error to stderr and exit with code 4

### Requirement 8: User Input Flexibility

**User Story:** As a developer, I want multiple ways to provide user input, so that I can integrate PAI into various workflows and scripts.

#### Acceptance Criteria

1. WHEN user input is provided via positional argument, THE PAI SHALL use that as the user message
2. WHEN user input is provided via stdin, THE PAI SHALL read stdin and use it as the user message
3. WHEN user input is provided via --input-file flag, THE PAI SHALL read the file and use its content as the user message
4. WHEN multiple input sources are provided, THE PAI SHALL output an error to stderr and exit with code 1
5. WHEN no user input is provided and no Session_File exists, THE PAI SHALL output an error to stderr and exit with code 1
6. WHEN reading an input file fails, THE PAI SHALL output an error to stderr and exit with code 4

### Requirement 9: bash_exec Tool Implementation

**User Story:** As a developer, I want the LLM to execute shell commands on my behalf, so that it can perform system operations and gather information.

#### Acceptance Criteria

1. THE PAI SHALL register a bash_exec tool with the LLM that accepts command and optional cwd parameters
2. WHEN the LLM invokes bash_exec, THE PAI SHALL execute the command using bash shell
3. WHEN executing commands, THE bash_exec_Tool SHALL support pipes, xargs, heredoc, and shell scripts
4. WHEN a cwd parameter is provided, THE bash_exec_Tool SHALL execute the command in that working directory
5. WHEN a command executes successfully, THE bash_exec_Tool SHALL return stdout, stderr, and exit code to the LLM
6. WHEN a command fails, THE bash_exec_Tool SHALL return the error information to the LLM
7. THE bash_exec_Tool SHALL NOT support interactive commands
8. THE bash_exec_Tool SHALL NOT implement security restrictions (user responsibility)

### Requirement 10: Model Parameter Configuration

**User Story:** As a developer, I want to configure model parameters like temperature and max tokens, so that I can control the LLM's behavior.

#### Acceptance Criteria

1. WHEN the --temperature flag is provided, THE PAI SHALL pass that value to the LLM
2. WHEN the --max-tokens flag is provided, THE PAI SHALL pass that value to the LLM
3. WHEN the --model flag is provided, THE PAI SHALL use that specific model
4. WHEN model parameters are invalid, THE PAI SHALL output an error to stderr and exit with code 1
5. WHEN the Config_File contains default model parameters, THE PAI SHALL use those unless overridden by CLI flags
6. WHEN the provider rejects parameters, THE PAI SHALL output an error to stderr and exit with code 3

### Requirement 11: Multimodal Input Support

**User Story:** As a developer, I want to include images in my messages, so that I can ask the LLM questions about visual content.

#### Acceptance Criteria

1. WHEN the --image flag is provided with a file path, THE PAI SHALL include that image in the user message
2. WHEN multiple --image flags are provided, THE PAI SHALL include all images in the user message
3. WHEN an image file cannot be read, THE PAI SHALL output an error to stderr and exit with code 4
4. THE PAI SHALL encode images in a format compatible with pi-ai_Library
5. WHEN the Session_File contains messages with images, THE PAI SHALL preserve the multimodal content structure

### Requirement 12: Log File Output

**User Story:** As a developer, I want to save conversation logs in a readable format, so that I can review interactions later.

#### Acceptance Criteria

1. WHEN the --log flag is provided with a file path, THE PAI SHALL write conversation output to that file in Markdown format
2. WHEN appending to a log file, THE PAI SHALL include timestamps for each message
3. WHEN appending to a log file, THE PAI SHALL clearly distinguish between user, assistant, and system messages
4. WHEN writing to a log file fails, THE PAI SHALL output an error to stderr and exit with code 4
5. THE PAI SHALL write to the log file in addition to stdout, not instead of it

### Requirement 13: Output Format Control

**User Story:** As a developer, I want to control output formatting, so that I can integrate PAI with other tools and scripts.

#### Acceptance Criteria

1. THE PAI SHALL always write the model's response to stdout
2. THE PAI SHALL write progress and diagnostic information to stderr
3. WHEN the --json flag is set, THE PAI SHALL format stderr output as NDJSON event stream
4. WHEN the --json flag is not set, THE PAI SHALL format stderr output as human-readable text
5. WHEN the --quiet flag is set, THE PAI SHALL suppress stderr output except for errors
6. THE PAI SHALL ensure stdout contains only model output for easy piping to other commands

### Requirement 14: Error Handling and Exit Codes

**User Story:** As a developer, I want clear error messages and consistent exit codes, so that I can handle errors appropriately in scripts.

#### Acceptance Criteria

1. WHEN operations succeed, THE PAI SHALL exit with code 0
2. WHEN parameter or usage errors occur, THE PAI SHALL exit with code 1
3. WHEN local runtime errors occur, THE PAI SHALL exit with code 2
4. WHEN external API or provider errors occur, THE PAI SHALL exit with code 3
5. WHEN IO or file errors occur, THE PAI SHALL exit with code 4
6. WHEN errors occur, THE PAI SHALL output descriptive error messages to stderr
7. THE PAI SHALL include relevant context in error messages (file paths, parameter names, etc.)

### Requirement 15: Provider and Model Selection

**User Story:** As a developer, I want to specify which provider and model to use, so that I can choose the most appropriate LLM for my task.

#### Acceptance Criteria

1. WHEN the --provider flag is provided, THE PAI SHALL use that provider
2. WHEN the --model flag is provided, THE PAI SHALL use that specific model
3. WHEN no provider is specified, THE PAI SHALL use the default provider from Config_File
4. WHEN no default provider is configured, THE PAI SHALL output an error to stderr and exit with code 1
5. WHEN the specified provider is not configured, THE PAI SHALL output an error to stderr and exit with code 1
6. WHEN the specified model is not available for the provider, THE PAI SHALL output an error to stderr and exit with code 3
