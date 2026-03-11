# Implementation Plan: PAI CLI Tool

## Overview

This implementation plan breaks down the PAI CLI tool into discrete coding tasks. The approach is incremental: start with core infrastructure (config, CLI parsing), then build session management, then implement the chat command with tool support, and finally add the model management commands. Each major component includes property-based tests to validate correctness properties from the design.

## Tasks

- [x] 1. Set up project infrastructure and core types
  - Create TypeScript interfaces for all data models (PAIConfig, ProviderConfig, Message, etc.)
  - Set up vitest testing framework with fast-check for property-based testing
  - Create directory structure for source and tests
  - Configure tsup build to ensure proper bin entry
  - _Requirements: All (foundational)_

- [ ] 2. Implement Configuration Manager
  - [x] 2.1 Create ConfigurationManager class with file I/O
    - Implement loadConfig() with JSON parsing and validation
    - Implement saveConfig() with atomic writes and directory creation
    - Handle config path resolution (--config > PAI_CONFIG > default)
    - Ensure schema_version field is always present
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [ ]* 2.2 Write property test for config path resolution priority
    - **Property 7: Config Path Resolution Priority**
    - **Validates: Requirements 3.4**
  
  - [ ]* 2.3 Write property test for schema version invariant
    - **Property 8: Config Schema Version Invariant**
    - **Validates: Requirements 3.5**
  
  - [ ]* 2.4 Write property test for config persistence round-trip
    - **Property 3: Configuration Persistence Round-Trip**
    - **Validates: Requirements 2.1**
  
  - [ ]* 2.5 Write unit tests for malformed config handling
    - Test various malformed JSON scenarios
    - Verify exit code 4 for IO errors
    - _Requirements: 1.5_

- [ ] 3. Implement credential resolution
  - [x] 3.1 Add resolveCredentials() method to ConfigurationManager
    - Check CLI parameters first
    - Check environment variables (PAI_<PROVIDER>_API_KEY pattern)
    - Check config file
    - Check auth.json for OAuth credentials
    - _Requirements: 4.1, 4.2, 4.3, 4.5_
  
  - [ ]* 3.2 Write property test for credential resolution priority
    - **Property 9: Credential Resolution Priority**
    - **Validates: Requirements 4.1, 4.2, 4.3**
  
  - [ ]* 3.3 Write property test for sensitive data exclusion
    - **Property 10: Sensitive Data Exclusion**
    - **Validates: Requirements 4.6**

- [ ] 4. Implement Session Manager
  - [x] 4.1 Create SessionManager class with JSONL support
    - Implement loadMessages() to read JSONL line by line
    - Implement appendMessage() and appendMessages() for atomic writes
    - Support multimodal content (string, object, array)
    - Handle missing files gracefully (return empty array)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.8_
  
  - [ ]* 4.2 Write property test for JSONL format correctness
    - **Property 13: Session File JSONL Format**
    - **Validates: Requirements 6.3, 6.4**
  
  - [ ]* 4.3 Write property test for multimodal content round-trip
    - **Property 15: Multimodal Content Round-Trip**
    - **Validates: Requirements 6.8, 11.5**
  
  - [ ]* 4.4 Write property test for malformed session error handling
    - **Property 14: Malformed Session Error Handling**
    - **Validates: Requirements 6.7**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement bash_exec tool
  - [x] 6.1 Create bash_exec tool with command execution
    - Implement createBashExecTool() function
    - Use child_process.exec with bash shell
    - Support cwd parameter for working directory
    - Capture stdout, stderr, and exit code
    - Return structured result to LLM
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  
  - [ ]* 6.2 Write property test for bash feature support
    - **Property 17: Bash Feature Support**
    - **Validates: Requirements 9.3**
  
  - [ ]* 6.3 Write property test for command result structure
    - **Property 18: Command Result Structure**
    - **Validates: Requirements 9.5**
  
  - [ ]* 6.4 Write unit tests for bash_exec edge cases
    - Test command failures
    - Test cwd parameter
    - Test various bash constructs (pipes, heredoc, etc.)
    - _Requirements: 9.2, 9.4, 9.6_

- [ ] 7. Implement Tool Registry
  - [ ] 7.1 Create ToolRegistry class
    - Implement register(), get(), getAll() methods
    - Implement execute() method for tool invocation
    - Register bash_exec tool in constructor
    - _Requirements: 9.1_
  
  - [ ]* 7.2 Write unit tests for tool registry
    - Test tool registration and retrieval
    - Test tool execution
    - _Requirements: 9.1_

- [ ] 8. Implement LLM Client wrapper
  - [ ] 8.1 Create LLMClient class wrapping pi-ai
    - Initialize pi-ai client based on provider
    - Implement chat() method for streaming responses
    - Implement chatComplete() method for non-streaming
    - Support tool calling via pi-ai
    - Handle provider-specific configuration
    - _Requirements: 5.1, 5.3, 5.4_
  
  - [ ]* 8.2 Write unit tests for LLM client
    - Mock pi-ai library
    - Test streaming and non-streaming modes
    - Test tool call handling
    - _Requirements: 5.1, 5.3, 5.4_

- [ ] 9. Implement Input Resolver
  - [ ] 9.1 Create InputResolver class
    - Implement resolveUserInput() for message/stdin/file/images
    - Implement resolveSystemInput() for --system/--system-file
    - Validate mutual exclusivity of input sources
    - Support multimodal content (text + images)
    - _Requirements: 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 11.1, 11.2, 11.4_
  
  - [ ]* 9.2 Write property test for input source mutual exclusivity
    - **Property 16: Input Source Mutual Exclusivity**
    - **Validates: Requirements 8.4**
  
  - [ ]* 9.3 Write unit tests for input resolution
    - Test each input source type
    - Test system instruction handling
    - Test image encoding
    - _Requirements: 7.1, 7.2, 8.1, 8.2, 8.3, 11.1, 11.2_

- [ ] 10. Implement Output Formatter
  - [ ] 10.1 Create OutputFormatter class
    - Implement writeModelOutput() for stdout
    - Implement writeProgress() for stderr (JSON/human-readable)
    - Implement writeError() for error messages
    - Implement appendToLog() for Markdown log files
    - Support --json, --quiet, and --log flags
    - _Requirements: 5.5, 5.6, 5.7, 12.1, 12.2, 12.3, 12.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_
  
  - [ ]* 10.2 Write property test for JSON output format validity
    - **Property 11: JSON Output Format Validity**
    - **Validates: Requirements 5.5**
  
  - [ ]* 10.3 Write property test for model output routing invariant
    - **Property 12: Model Output Routing Invariant**
    - **Validates: Requirements 5.7, 13.1, 13.2, 13.6**
  
  - [ ]* 10.4 Write property test for log file timestamps
    - **Property 20: Log File Timestamp Presence**
    - **Validates: Requirements 12.2**
  
  - [ ]* 10.5 Write property test for log file message distinction
    - **Property 21: Log File Message Distinction**
    - **Validates: Requirements 12.3**
  
  - [ ]* 10.6 Write unit tests for output formatting
    - Test JSON vs human-readable modes
    - Test quiet mode
    - Test log file writing
    - _Requirements: 5.6, 13.4, 13.5_

- [ ] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Implement chat command handler
  - [ ] 12.1 Create handleChatCommand() function
    - Parse and validate chat command options
    - Resolve configuration and credentials
    - Load session history if --session provided
    - Resolve system instructions and user input
    - Initialize LLM client with tools
    - Handle streaming/non-streaming responses
    - Append messages to session file
    - Format and output responses
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.5, 6.6, 7.4, 10.1, 10.2, 10.3, 10.5_
  
  - [ ]* 12.2 Write integration tests for chat command
    - Test basic chat flow
    - Test with session file
    - Test with system instructions
    - Test streaming vs non-streaming
    - Test tool invocation
    - Mock pi-ai library
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.5, 6.6_

- [ ] 13. Implement model list command
  - [ ] 13.1 Create handleModelList() function
    - Load configuration
    - Display configured providers with details
    - Support --all flag to show all pi-ai supported providers
    - Format output with provider name, models, auth status
    - Handle missing config file gracefully
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [ ]* 13.2 Write property test for provider information display
    - **Property 1: Provider Information Display Completeness**
    - **Validates: Requirements 1.3**
  
  - [ ]* 13.3 Write unit tests for model list command
    - Test with configured providers
    - Test with --all flag
    - Test with missing config
    - _Requirements: 1.1, 1.2, 1.4_

- [ ] 14. Implement model config command
  - [ ] 14.1 Create handleModelConfig() function
    - Support --add flag to add/update provider
    - Support --delete flag to remove provider
    - Validate provider is supported by pi-ai
    - Create config file if doesn't exist
    - Update existing config atomically
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [ ]* 14.2 Write property test for provider validation
    - **Property 5: Provider Validation**
    - **Validates: Requirements 2.3**
  
  - [ ]* 14.3 Write property test for configuration deletion
    - **Property 4: Configuration Deletion**
    - **Validates: Requirements 2.2**
  
  - [ ]* 14.4 Write unit tests for model config command
    - Test adding new provider
    - Test updating existing provider
    - Test deleting provider
    - Test creating config file
    - _Requirements: 2.1, 2.2, 2.4_

- [ ] 15. Implement CLI parser and main entry point
  - [ ] 15.1 Create main CLI structure with Commander.js
    - Define all commands and options
    - Wire up command handlers
    - Implement global error handling
    - Map errors to correct exit codes
    - Ensure error messages include context
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 15.1, 15.2, 15.3, 15.4, 15.5_
  
  - [ ]* 15.2 Write property test for exit code correctness
    - **Property 6: Exit Code Correctness**
    - **Validates: Requirements 2.5, 2.6, 2.7, 5.8, 5.9, 14.1, 14.2, 14.3, 14.4, 14.5**
  
  - [ ]* 15.3 Write property test for error message context
    - **Property 22: Error Message Context**
    - **Validates: Requirements 14.7**
  
  - [ ]* 15.4 Write property test for invalid parameter rejection
    - **Property 19: Invalid Parameter Rejection**
    - **Validates: Requirements 10.4**
  
  - [ ]* 15.5 Write property test for provider existence validation
    - **Property 23: Provider Existence Validation**
    - **Validates: Requirements 15.5**

- [ ] 16. Implement provider and model selection
  - [ ] 16.1 Add provider/model selection logic
    - Support --provider and --model flags
    - Use default provider from config if not specified
    - Validate provider is configured
    - Pass model parameters (temperature, max-tokens) to LLM
    - Handle config defaults with CLI overrides
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 15.1, 15.2, 15.3_
  
  - [ ]* 16.2 Write unit tests for provider/model selection
    - Test explicit provider selection
    - Test default provider
    - Test model parameter passing
    - Test config defaults with overrides
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 15.1, 15.2, 15.3_

- [ ] 17. Final checkpoint and integration testing
  - [ ] 17.1 Run full test suite
    - Ensure all unit tests pass
    - Ensure all property tests pass (100+ iterations each)
    - Verify test coverage meets goals (>90% line, >85% branch)
    - _Requirements: All_
  
  - [ ]* 17.2 Write end-to-end integration tests
    - Test complete chat workflow with real session files
    - Test model configuration workflow
    - Test error scenarios end-to-end
    - Use temp directories for file operations
    - _Requirements: All_
  
  - [ ] 17.3 Manual testing and validation
    - Test with actual pi-ai library (not mocked)
    - Verify bash_exec tool works with real commands
    - Test piping and stdin input
    - Verify output formatting in terminal
    - Test with existing auth.json
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties with 100+ iterations
- Unit tests validate specific examples and edge cases
- Integration tests verify component interactions
- The implementation builds incrementally: infrastructure → components → commands → integration
