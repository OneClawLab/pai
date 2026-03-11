import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tool-registry.js';
import type { Tool } from '../../src/types.js';

describe('ToolRegistry', () => {
  describe('initialization', () => {
    it('should register built-in tools on construction', () => {
      const registry = new ToolRegistry();
      
      expect(registry.size()).toBeGreaterThan(0);
      expect(registry.has('bash_exec')).toBe(true);
    });

    it('should have bash_exec tool registered', () => {
      const registry = new ToolRegistry();
      const tool = registry.get('bash_exec');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('bash_exec');
      expect(tool?.handler).toBeTypeOf('function');
    });
  });

  describe('register', () => {
    it('should register a new tool', () => {
      const registry = new ToolRegistry();
      const customTool: Tool = {
        name: 'custom_tool',
        description: 'A custom tool',
        parameters: { type: 'object', properties: {} },
        handler: async () => ({ result: 'success' }),
      };

      registry.register(customTool);

      expect(registry.has('custom_tool')).toBe(true);
      expect(registry.get('custom_tool')).toBe(customTool);
    });

    it('should replace existing tool with same name', () => {
      const registry = new ToolRegistry();
      const tool1: Tool = {
        name: 'test_tool',
        description: 'First version',
        parameters: {},
        handler: async () => 'v1',
      };
      const tool2: Tool = {
        name: 'test_tool',
        description: 'Second version',
        parameters: {},
        handler: async () => 'v2',
      };

      registry.register(tool1);
      registry.register(tool2);

      const retrieved = registry.get('test_tool');
      expect(retrieved?.description).toBe('Second version');
    });
  });

  describe('get', () => {
    it('should return tool by name', () => {
      const registry = new ToolRegistry();
      const tool = registry.get('bash_exec');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('bash_exec');
    });

    it('should return undefined for non-existent tool', () => {
      const registry = new ToolRegistry();
      const tool = registry.get('nonexistent');

      expect(tool).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all registered tools', () => {
      const registry = new ToolRegistry();
      const tools = registry.getAll();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'bash_exec')).toBe(true);
    });

    it('should return array with custom tools', () => {
      const registry = new ToolRegistry();
      const customTool: Tool = {
        name: 'custom',
        description: 'Custom',
        parameters: {},
        handler: async () => ({}),
      };

      registry.register(customTool);
      const tools = registry.getAll();

      expect(tools.some((t) => t.name === 'custom')).toBe(true);
    });
  });

  describe('execute', () => {
    it('should execute tool by name', async () => {
      const registry = new ToolRegistry();
      const mockTool: Tool = {
        name: 'mock_tool',
        description: 'Mock tool',
        parameters: {},
        handler: async (args: any) => ({ input: args, output: 'success' }),
      };

      registry.register(mockTool);
      const result = await registry.execute('mock_tool', { test: 'data' });

      expect(result).toEqual({ input: { test: 'data' }, output: 'success' });
    });

    it('should throw error for non-existent tool', async () => {
      const registry = new ToolRegistry();

      await expect(registry.execute('nonexistent', {})).rejects.toThrow(
        'Tool not found: nonexistent'
      );
    });

    it('should pass arguments to tool handler', async () => {
      const registry = new ToolRegistry();
      let receivedArgs: any = null;
      const mockTool: Tool = {
        name: 'test',
        description: 'Test',
        parameters: {},
        handler: async (args: any) => {
          receivedArgs = args;
          return {};
        },
      };

      registry.register(mockTool);
      await registry.execute('test', { foo: 'bar', num: 42 });

      expect(receivedArgs).toEqual({ foo: 'bar', num: 42 });
    });
  });

  describe('has', () => {
    it('should return true for existing tool', () => {
      const registry = new ToolRegistry();
      expect(registry.has('bash_exec')).toBe(true);
    });

    it('should return false for non-existent tool', () => {
      const registry = new ToolRegistry();
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('size', () => {
    it('should return number of registered tools', () => {
      const registry = new ToolRegistry();
      const initialSize = registry.size();

      const customTool: Tool = {
        name: 'custom',
        description: 'Custom',
        parameters: {},
        handler: async () => ({}),
      };

      registry.register(customTool);

      expect(registry.size()).toBe(initialSize + 1);
    });
  });
});
