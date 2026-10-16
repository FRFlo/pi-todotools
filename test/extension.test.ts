import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import todotoolsExtension, { TASK_MANAGEMENT_SECTION, TODO_STATE_ENTRY_TYPE, type TodoPhase } from "../src/index.js";

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>;

function createMockPi() {
	const handlers = new Map<string, EventHandler[]>();
	const eventHandlers = new Map<string, (payload: unknown) => void>();
	const registeredTools: string[] = [];
	const pi = {
		registerTool(tool: { name: string }) {
			registeredTools.push(tool.name);
		},
		appendEntry: vi.fn(),
		on(event: string, handler: EventHandler) {
			const eventHandlers = handlers.get(event) ?? [];
			eventHandlers.push(handler);
			handlers.set(event, eventHandlers);
			return () => {
				handlers.set(
					event,
					(handlers.get(event) ?? []).filter((candidate) => candidate !== handler),
				);
			};
		},
		events: {
			emit: vi.fn(),
			on: vi.fn((event: string, handler: (payload: unknown) => void) => {
				eventHandlers.set(event, handler);
				return () => eventHandlers.delete(event);
			}),
		},
	} as Partial<ExtensionAPI> as ExtensionAPI;
	return { pi, handlers, registeredTools, eventHandlers };
}

describe("todotools extension", () => {
	it("registers the phased todo tool and appends task-management guidance", async () => {
		// given
		const { pi, handlers, registeredTools } = createMockPi();

		// when
		todotoolsExtension(pi);
		const beforeAgentStartHandlers = handlers.get("before_agent_start") ?? [];
		const ctx = {
			sessionManager: { getSessionId: () => "session-1" },
		} as Partial<ExtensionContext> as ExtensionContext;
		const results = [];
		for (const handler of beforeAgentStartHandlers) {
			results.push(
				await handler(
					{
						type: "before_agent_start",
						prompt: "work",
						systemPrompt: "base",
						systemPromptOptions: { cwd: process.cwd() },
					},
					ctx,
				),
			);
		}

		// then
		expect(registeredTools).toEqual(["todo"]);
		expect(results).toContainEqual({ systemPrompt: `base\n${TASK_MANAGEMENT_SECTION}` });
	});

	it("bridges supervisor read/write with validation, persistence, widget refresh, and state event", async () => {
		const { pi, handlers, eventHandlers } = createMockPi();
		todotoolsExtension(pi);
		const setWidget = vi.fn();
		const ctx = { sessionManager: { getBranch: () => [] }, ui: { setWidget } } as unknown as ExtensionContext;
		await handlers.get("session_start")?.[0]?.({ type: "session_start" }, ctx);
		const read = eventHandlers.get("pi-todotools:supervisor-read");
		const write = eventHandlers.get("pi-todotools:supervisor-write");
		expect(read).toBeDefined();
		const request = { requestId: "req-1" } as { requestId: string; snapshot?: { phases: TodoPhase[] } };
		read?.(request);
		expect(request.snapshot).toEqual({ phases: [] });
		const phases: TodoPhase[] = [
			{ name: "Plan", tasks: [{ content: "Task", status: "pending", supervisorContext: "secret" }] },
		];
		write?.({ requestId: "write-1", phases });
		expect(pi.appendEntry).toHaveBeenCalledWith(TODO_STATE_ENTRY_TYPE, { schema: "v2", phases });
		expect(setWidget).toHaveBeenLastCalledWith("todo-sidebar", ["Todo", "Plan", "[ ] Task", "  Supervisor: secret"]);
		expect(pi.events.emit).toHaveBeenCalledWith("pi-todotools:state-updated", { phases });
		const writes = (pi.appendEntry as ReturnType<typeof vi.fn>).mock.calls.length;
		write?.({ requestId: "bad", phases: [{ name: "bad", tasks: [{ content: 3, status: "pending" }] }] });
		write?.(null);
		read?.({ nope: true });
		expect((pi.appendEntry as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(writes);
	});

	it("restores phased state from the session branch and refreshes the sidebar", async () => {
		// given a branch holding a legacy flat todowrite-era snapshot
		const { pi, handlers } = createMockPi();
		todotoolsExtension(pi);
		const setWidget = vi.fn();
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
						type: "custom",
						customType: TODO_STATE_ENTRY_TYPE,
						data: {
							todos: [
								{ content: "Legacy open", status: "pending", priority: "high" },
								{ content: "Legacy closed", status: "completed", priority: "low" },
							],
						},
					},
				],
			},
			ui: { setWidget },
		} as unknown as ExtensionContext;

		// when the session starts
		const sessionStartHandlers = handlers.get("session_start") ?? [];
		expect(sessionStartHandlers).toHaveLength(1);
		for (const handler of sessionStartHandlers) {
			await handler({ type: "session_start", reason: "startup", cwd: process.cwd() }, ctx);
		}

		// then the sidebar shows the migrated open task
		expect(setWidget).toHaveBeenCalledWith("todo-sidebar", ["Todo", "Tasks", "[ ] Legacy open", "[✓] Legacy closed"]);

		// and the agent receives op-based prompt guidance
		expect(TASK_MANAGEMENT_SECTION).toContain("op-based");
	});
});
