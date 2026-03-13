/**
 * Squad Manager Tests
 *
 * Tests for the SquadManager lifecycle management.
 */

import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SquadMemberConfig } from "./loader.js";
import { SquadManager } from "./manager.js";

describe("SquadManager", () => {
	let manager: SquadManager;
	const testCwd = process.cwd();

	beforeEach(() => {
		manager = new SquadManager(testCwd);
	});

	afterEach(() => {
		manager.destroyAll();
	});

	describe("constructor", () => {
		it("creates manager with session directory", () => {
			assert.ok(manager);
			assert.strictEqual(manager.getRoles().length, 0);
		});

		it("accepts optional callbacks", () => {
			let statusChanged = false;
			const callbackManager = new SquadManager(testCwd, {
				onStatusChange: () => {
					statusChanged = true;
				},
			});

			// Callback should not be called yet
			assert.strictEqual(statusChanged, false);

			callbackManager.destroyAll();
		});
	});

	describe("loadMembers", () => {
		it("loads squad member configs", () => {
			const configs: SquadMemberConfig[] = [
				{
					role: "test",
					name: "Test Member",
					description: "A test member",
					systemPrompt: "You are a test member.",
					tools: undefined,
					model: undefined,
					thinking: "off",
					timeout: 60000,
					extensions: [],
					noExtensions: false,
					env: {},
					scope: "project",
					sourcePath: "/test/test.md",
				},
			];

			manager.loadMembers(configs);

			const roles = manager.getRoles();
			assert.strictEqual(roles.length, 1);
			assert.strictEqual(roles[0], "test");
		});

		it("replaces existing members", () => {
			const configs1: SquadMemberConfig[] = [
				{
					role: "test1",
					name: "Test 1",
					description: "",
					systemPrompt: "Prompt 1",
					tools: undefined,
					model: undefined,
					thinking: "off",
					timeout: 60000,
					extensions: [],
					noExtensions: false,
					env: {},
					scope: "project",
					sourcePath: "/test/test1.md",
				},
			];

			manager.loadMembers(configs1);
			assert.strictEqual(manager.getRoles().length, 1);

			const configs2: SquadMemberConfig[] = [
				{
					role: "test2",
					name: "Test 2",
					description: "",
					systemPrompt: "Prompt 2",
					tools: undefined,
					model: undefined,
					thinking: "off",
					timeout: 60000,
					extensions: [],
					noExtensions: false,
					env: {},
					scope: "project",
					sourcePath: "/test/test2.md",
				},
			];

			manager.loadMembers(configs2);
			assert.strictEqual(manager.getRoles().length, 1);
			assert.strictEqual(manager.getRoles()[0], "test2");
		});
	});

	describe("getMembers", () => {
		it("returns map of member instances", () => {
			const configs: SquadMemberConfig[] = [
				{
					role: "reviewer",
					name: "Reviewer",
					description: "",
					systemPrompt: "Review code",
					tools: "read",
					model: undefined,
					thinking: "off",
					timeout: 60000,
					extensions: [],
					noExtensions: false,
					env: {},
					scope: "project",
					sourcePath: "/test/reviewer.md",
				},
			];

			manager.loadMembers(configs);

			const members = manager.getMembers();
			assert.ok(members.has("reviewer"));

			const member = members.get("reviewer");
			assert.ok(member);
			assert.strictEqual(member.config.role, "reviewer");
			assert.strictEqual(member.status, "idle");
			assert.strictEqual(member.proc, null);
		});
	});

	describe("getMember", () => {
		it("returns specific member", () => {
			const configs: SquadMemberConfig[] = [
				{
					role: "scout",
					name: "Scout",
					description: "",
					systemPrompt: "Scout codebase",
					tools: undefined,
					model: undefined,
					thinking: "off",
					timeout: 60000,
					extensions: [],
					noExtensions: false,
					env: {},
					scope: "project",
					sourcePath: "/test/scout.md",
				},
			];

			manager.loadMembers(configs);

			const member = manager.getMember("scout");
			assert.ok(member);
			assert.strictEqual(member.config.role, "scout");
		});

		it("returns undefined for unknown member", () => {
			const member = manager.getMember("unknown");
			assert.strictEqual(member, undefined);
		});
	});

	describe("isAllDone", () => {
		it("returns true when no members loaded", () => {
			assert.strictEqual(manager.isAllDone(), true);
		});

		it("returns true when all members are idle", () => {
			const configs: SquadMemberConfig[] = [
				{
					role: "test",
					name: "Test",
					description: "",
					systemPrompt: "Test",
					tools: undefined,
					model: undefined,
					thinking: "off",
					timeout: 60000,
					extensions: [],
					noExtensions: false,
					env: {},
					scope: "project",
					sourcePath: "/test/test.md",
				},
			];

			manager.loadMembers(configs);
			assert.strictEqual(manager.isAllDone(), true);
		});
	});

	describe("destroyAll", () => {
		it("clears all members", () => {
			const configs: SquadMemberConfig[] = [
				{
					role: "test",
					name: "Test",
					description: "",
					systemPrompt: "Test",
					tools: undefined,
					model: undefined,
					thinking: "off",
					timeout: 60000,
					extensions: [],
					noExtensions: false,
					env: {},
					scope: "project",
					sourcePath: "/test/test.md",
				},
			];

			manager.loadMembers(configs);
			assert.strictEqual(manager.getRoles().length, 1);

			manager.destroyAll();
			assert.strictEqual(manager.getRoles().length, 0);
		});
	});
});

describe("SquadManager dispatch (mock)", () => {
	it("dispatchOne returns error for unknown role", async () => {
		const manager = new SquadManager(process.cwd());

		const result = await manager.dispatchOne("unknown", "test prompt");

		assert.strictEqual(result.role, "unknown");
		assert.strictEqual(result.status, "error");
		assert.strictEqual(result.error, "Unknown squad member: unknown");

		manager.destroyAll();
	});

	it("dispatchAll resolves with empty array when no members", async () => {
		const manager = new SquadManager(process.cwd());

		const results = await manager.dispatchAll("test prompt");

		assert.strictEqual(results.length, 0);

		manager.destroyAll();
	});
});
