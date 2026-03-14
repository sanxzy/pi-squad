/**
 * Messenger Extension - Loader Module Tests
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	discoverIdentities,
	getMyIdentity,
	getContacts,
	getContact,
	contactExists,
	getAllAgentNames,
} from "./loader.js";

describe("Loader Module", () => {
	let testDir: string;

	beforeEach(() => {
		// Create a temporary directory for each test
		testDir = mkdtempSync(join(tmpdir(), "messenger-loader-test-"));
		// Create the squad directory
		mkdirSync(join(testDir, ".pi", "squad"), { recursive: true });
	});

	afterEach(() => {
		// Clean up the temporary directory after each test
		rmSync(testDir, { recursive: true, force: true });
	});

	describe("discoverIdentities", () => {
		it("should return empty map for no squad directory", () => {
			const identities = discoverIdentities(testDir);
			assert.strictEqual(identities.size, 0);
		});

		it("should discover identities from squad files", () => {
			// Create squad member file
			writeFileSync(
				join(testDir, ".pi", "squad", "pixlo.md"),
				`---
name: Pixlo
description: AI Implementer
model: zai/glm-5
tools: read,edit_file
---

You are Pixlo, an AI implementer.`,
			);

			const identities = discoverIdentities(testDir);

			assert.strictEqual(identities.size, 1);
			assert.ok(identities.has("pixlo"));

			const pixlo = identities.get("pixlo")!;
			assert.strictEqual(pixlo.name, "pixlo");
			assert.strictEqual(pixlo.displayName, "Pixlo");
			assert.strictEqual(pixlo.description, "AI Implementer");
			assert.strictEqual(pixlo.model, "zai/glm-5");
			assert.strictEqual(pixlo.tools, "read,edit_file");
			assert.strictEqual(pixlo.scope, "project");
		});

		it("should use filename as name when no name in frontmatter", () => {
			writeFileSync(
				join(testDir, ".pi", "squad", "finder.md"),
				`---
description: Finder agent
---

You are Finder.`,
			);

			const identities = discoverIdentities(testDir);

			assert.strictEqual(identities.size, 1);
			const finder = identities.get("finder")!;
			assert.strictEqual(finder.displayName, "Finder");
		});

		it("should title-case name when not provided", () => {
			writeFileSync(
				join(testDir, ".pi", "squad", "implementer.md"),
				`---
description: Implementation agent
---

You are Implementer.`,
			);

			const identities = discoverIdentities(testDir);
			const impl = identities.get("implementer")!;

			assert.strictEqual(impl.displayName, "Implementer");
		});

		it("should skip files without system prompt body", () => {
			writeFileSync(
				join(testDir, ".pi", "squad", "empty.md"),
				`---
name: Empty
description: No body
---`,
			);

			const identities = discoverIdentities(testDir);
			assert.strictEqual(identities.size, 0);
		});

		it("should handle multiple squad members", () => {
			writeFileSync(
				join(testDir, ".pi", "squad", "pixlo.md"),
				`---
name: Pixlo
---

You are Pixlo.`,
			);

			writeFileSync(
				join(testDir, ".pi", "squad", "finder.md"),
				`---
name: Finder
---

You are Finder.`,
			);

			writeFileSync(
				join(testDir, ".pi", "squad", "critic.md"),
				`---
name: Critic
---

You are Critic.`,
			);

			const identities = discoverIdentities(testDir);
			assert.strictEqual(identities.size, 3);
			assert.ok(identities.has("pixlo"));
			assert.ok(identities.has("finder"));
			assert.ok(identities.has("critic"));
		});

		it("should ignore non-md files", () => {
			writeFileSync(join(testDir, ".pi", "squad", "test.txt"), "Not a squad member");
			writeFileSync(
				join(testDir, ".pi", "squad", "valid.md"),
				`---
name: Valid
---

You are valid.`,
			);

			const identities = discoverIdentities(testDir);
			assert.strictEqual(identities.size, 1);
			assert.ok(identities.has("valid"));
		});
	});

	describe("getMyIdentity", () => {
		it("should return null for non-existent identity", () => {
			const identity = getMyIdentity(testDir, "nonexistent");
			assert.strictEqual(identity, null);
		});

		it("should return identity for existing agent", () => {
			writeFileSync(
				join(testDir, ".pi", "squad", "pixlo.md"),
				`---
name: Pixlo
description: The implementer
model: zai/glm-5
---

You are Pixlo.`,
			);

			const identity = getMyIdentity(testDir, "pixlo");

			assert.notStrictEqual(identity, null);
			assert.strictEqual(identity!.name, "pixlo");
			assert.strictEqual(identity!.displayName, "Pixlo");
			assert.strictEqual(identity!.description, "The implementer");
			assert.strictEqual(identity!.model, "zai/glm-5");
		});
	});

	describe("getContacts", () => {
		it("should return empty array for no other members", () => {
			writeFileSync(
				join(testDir, ".pi", "squad", "pixlo.md"),
				`---
name: Pixlo
---

You are Pixlo.`,
			);

			const contacts = getContacts(testDir, "pixlo");
			assert.strictEqual(contacts.length, 0);
		});

		it("should return all other members as contacts", () => {
			writeFileSync(
				join(testDir, ".pi", "squad", "pixlo.md"),
				`---
name: Pixlo
---

You are Pixlo.`,
			);

			writeFileSync(
				join(testDir, ".pi", "squad", "finder.md"),
				`---
name: Finder
description: Finder agent
---

You are Finder.`,
			);

			writeFileSync(
				join(testDir, ".pi", "squad", "critic.md"),
				`---
name: Critic
description: Critic agent
model: anthropic/claude-sonnet
---

You are Critic.`,
			);

			const contacts = getContacts(testDir, "pixlo");

			assert.strictEqual(contacts.length, 2);

			// Should be sorted by displayName
			assert.strictEqual(contacts[0]!.name, "critic");
			assert.strictEqual(contacts[1]!.name, "finder");

			// Should not include self
			const names = contacts.map((c) => c.name);
			assert.ok(!names.includes("pixlo"));
		});

		it("should exclude specified name from contacts", () => {
			writeFileSync(
				join(testDir, ".pi", "squad", "pixlo.md"),
				`---
name: Pixlo
---

You are Pixlo.`,
			);

			writeFileSync(
				join(testDir, ".pi", "squad", "finder.md"),
				`---
name: Finder
---

You are Finder.`,
			);

			const contactsAsFinder = getContacts(testDir, "finder");
			assert.strictEqual(contactsAsFinder.length, 1);
			assert.strictEqual(contactsAsFinder[0]!.name, "pixlo");
		});
	});

	describe("getContact", () => {
		it("should return null for non-existent contact", () => {
			const contact = getContact(testDir, "nonexistent");
			assert.strictEqual(contact, null);
		});

		it("should return contact for existing member", () => {
			writeFileSync(
				join(testDir, ".pi", "squad", "finder.md"),
				`---
name: Finder
description: The finder
tools: glob,grep
---

You are Finder.`,
			);

			const contact = getContact(testDir, "finder");

			assert.notStrictEqual(contact, null);
			assert.strictEqual(contact!.name, "finder");
			assert.strictEqual(contact!.displayName, "Finder");
			assert.strictEqual(contact!.description, "The finder");
			assert.strictEqual(contact!.tools, "glob,grep");
		});
	});

	describe("contactExists", () => {
		it("should return false for non-existent contact", () => {
			const exists = contactExists(testDir, "nonexistent");
			assert.strictEqual(exists, false);
		});

		it("should return true for existing contact", () => {
			writeFileSync(
				join(testDir, ".pi", "squad", "finder.md"),
				`---
name: Finder
---

You are Finder.`,
			);

			const exists = contactExists(testDir, "finder");
			assert.strictEqual(exists, true);
		});
	});

	describe("getAllAgentNames", () => {
		it("should return empty array for no agents", () => {
			const names = getAllAgentNames(testDir);
			assert.strictEqual(names.length, 0);
		});

		it("should return all agent names", () => {
			writeFileSync(
				join(testDir, ".pi", "squad", "pixlo.md"),
				`---
name: Pixlo
---

You are Pixlo.`,
			);

			writeFileSync(
				join(testDir, ".pi", "squad", "finder.md"),
				`---
name: Finder
---

You are Finder.`,
			);

			const names = getAllAgentNames(testDir);
			assert.strictEqual(names.length, 2);
			assert.ok(names.includes("pixlo"));
			assert.ok(names.includes("finder"));
		});
	});
});
