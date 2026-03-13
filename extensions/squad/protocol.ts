/**
 * Squad Extension - JSONL Protocol Helpers
 *
 * Provides utilities for building CLI arguments and creating JSONL commands
 * for communication with squad member subprocesses.
 */

/**
 * Build the CLI args array for spawning a squad member subprocess.
 *
 * @param config - Squad member configuration
 * @returns Array of CLI arguments for the pi command
 */
export function buildSpawnArgs(config: {
	sessionFile: string;
	systemPrompt: string;
	model?: string;
	tools?: string;
	thinking?: string;
	noExtensions?: boolean;
	extensions?: string[];
}): string[] {
	const args: string[] = [
		"--mode",
		"rpc",
		"--session",
		config.sessionFile,
		"--system-prompt",
		config.systemPrompt,
		"--no-auto-compaction",
	];

	if (config.model) {
		args.push("--model", config.model);
	}

	if (config.tools) {
		args.push("--tools", config.tools);
	}

	args.push("--thinking", config.thinking || "off");

	if (config.noExtensions) {
		args.push("--no-extensions");
	} else if (config.extensions) {
		for (const ext of config.extensions) {
			args.push("--extension", ext);
		}
	}

	return args;
}

/**
 * Create a JSONL prompt command.
 *
 * @param message - The prompt message to send
 * @returns JSONL-formatted command string with newline
 */
export function createPromptCommand(message: string): string {
	return `${JSON.stringify({ type: "prompt", message })}\n`;
}

/**
 * Create a JSONL abort command.
 *
 * @returns JSONL-formatted abort command string with newline
 */
export function createAbortCommand(): string {
	return `${JSON.stringify({ type: "abort" })}\n`;
}

/**
 * Parse a JSONL line into an event object.
 *
 * @param line - A single line from stdout
 * @returns Parsed event object or null if invalid
 */
export function parseJSONLLine(line: string): Record<string, unknown> | null {
	if (!line.trim()) {
		return null;
	}

	try {
		return JSON.parse(line) as Record<string, unknown>;
	} catch {
		// Ignore non-JSON output (e.g., startup messages, warnings)
		return null;
	}
}
