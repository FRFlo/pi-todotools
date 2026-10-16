import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TASK_MANAGEMENT_SECTION } from "./prompt.js";
import { getTodoWidgetLines } from "./rendering.js";
import { clonePhases, getLatestPhasesFromBranchEntries, TODO_STATE_ENTRY_TYPE, type TodoPhase } from "./state.js";
import { registerTodoTool } from "./tools/todo.js";

function isValidPhases(value: unknown): value is TodoPhase[] {
	return (
		Array.isArray(value) &&
		value.every((phase) => {
			if (
				typeof phase !== "object" ||
				phase === null ||
				typeof phase.name !== "string" ||
				!Array.isArray(phase.tasks)
			)
				return false;
			return phase.tasks.every((task: unknown) => {
				if (typeof task !== "object" || task === null) return false;
				const item = task as Record<string, unknown>;
				return (
					typeof item["content"] === "string" &&
					["pending", "in_progress", "completed", "abandoned"].includes(String(item["status"])) &&
					(item["guidance"] === undefined || typeof item["guidance"] === "string") &&
					(item["supervisorContext"] === undefined || typeof item["supervisorContext"] === "string")
				);
			});
		})
	);
}

function getLatestPhases(ctx: ExtensionContext): TodoPhase[] {
	return getLatestPhasesFromBranchEntries(ctx.sessionManager.getBranch());
}

export default function todotoolsExtension(pi: ExtensionAPI): void {
	let currentPhases: TodoPhase[] = [];
	let activeContext: ExtensionContext | undefined;
	const getCurrentPhases = (): TodoPhase[] => clonePhases(currentPhases);
	const emitState = (): void => {
		pi.events.emit("pi-todotools:state-updated", { phases: clonePhases(currentPhases) });
	};
	const setCurrentPhases = (phases: TodoPhase[]): void => {
		currentPhases = clonePhases(phases);
		emitState();
	};
	const syncWidget = (ctx: ExtensionContext): void => {
		activeContext = ctx;
		ctx.ui.setWidget("todo-sidebar", getTodoWidgetLines(currentPhases));
	};
	const syncFromSession = (ctx: ExtensionContext): void => {
		currentPhases = getLatestPhases(ctx);
		syncWidget(ctx);
		emitState();
	};
	pi.on("session_start", async (_event, ctx) => syncFromSession(ctx));
	pi.on("session_tree", async (_event, ctx) => syncFromSession(ctx));
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n${TASK_MANAGEMENT_SECTION}`,
	}));
	pi.events.on("pi-todotools:supervisor-read", (payload: unknown) => {
		if (
			typeof payload !== "object" ||
			payload === null ||
			typeof (payload as { requestId?: unknown }).requestId !== "string"
		)
			return;
		(payload as { snapshot?: { phases: TodoPhase[] } }).snapshot = { phases: clonePhases(currentPhases) };
	});
	pi.events.on("pi-todotools:supervisor-write", (payload: unknown) => {
		if (typeof payload !== "object" || payload === null) return;
		const phases = (payload as { phases?: unknown }).phases;
		if (!isValidPhases(phases)) return;
		currentPhases = clonePhases(phases);
		pi.appendEntry(TODO_STATE_ENTRY_TYPE, { schema: "v2", phases: clonePhases(currentPhases) });
		if (activeContext) syncWidget(activeContext);
		emitState();
	});
	registerTodoTool(pi, { getCurrentPhases, setCurrentPhases, syncWidget });
}

export { markdownToPhases, phasesToMarkdown, resolveTodoMarkdownPath } from "./markdown.js";
export {
	appendItems,
	applyEntry,
	applyOpsToPhases,
	applyParams,
	getCompletionTransitions,
	getTaskTargets,
	initPhases,
	nextActionableTask,
	normalizeInProgressTask,
	removeTasks,
	resolvePhaseOrError,
	resolveTaskOrError,
} from "./operations.js";
export { TASK_MANAGEMENT_SECTION, TODO_TOOL_DESCRIPTION } from "./prompt.js";
export {
	formatSummary,
	getTodoMarker,
	getTodoResultLines,
	getTodoWidgetLines,
	isIncompleteTodo,
	isTerminalTodoStatus,
	sanitizeTodoText,
} from "./rendering.js";
export {
	type BranchEntry,
	clonePhases,
	cloneTask,
	DEFAULT_INIT_PHASE,
	findPhaseByName,
	findTaskByContent,
	getLatestPhasesFromBranchEntries,
	getLatestTodosFromBranchEntries,
	isTodoItem,
	isTodoItemArray,
	isTodoPhase,
	isTodoPhaseArray,
	type TaskHit,
	TODO_STATE_ENTRY_TYPE,
	type TodoCompletionTransition,
	type TodoItem,
	type TodoOpEntry,
	type TodoOperation,
	type TodoPhase,
	type TodoPhaseInput,
	type TodoStateEntry,
	type TodoStatus,
	type TodoToolDetails,
} from "./state.js";
export { phaseRomanNumeral, registerTodoTool, TODO_PARAMS_SCHEMA } from "./tools/todo.js";
