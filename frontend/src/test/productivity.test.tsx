import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reminder, Task } from "@/features/productivity/api";
import { fromLocalParts, relativeTime, repeatLabel, toLocalParts, tomorrowMorningIso } from "@/features/productivity/constants";
import { emptyDashboard, emptyReminderList, emptyTaskList, mockApi, renderApp, sentBody } from "./utils";

afterEach(() => vi.unstubAllGlobals());

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Pay internet bill",
    description: null,
    category: "Home",
    priority: "high",
    status: "not_started",
    due_date: "2026-09-24",
    due_time: "18:30:00",
    recurrence: null,
    created_at: "2026-09-20T00:00:00Z",
    completed_at: null,
    previous_task_id: null,
    is_overdue: false,
    is_due_soon: true,
    ...overrides,
  };
}

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "r1",
    title: "Call landlord",
    notes: null,
    remind_at: "2026-09-25T03:15:00Z",
    repeat: "none",
    interval_count: null,
    interval_unit: null,
    status: "active",
    snoozed_until: null,
    completed_at: null,
    last_completed_at: null,
    created_at: "2026-09-20T00:00:00Z",
    effective_at: "2026-09-25T03:15:00Z",
    is_due: false,
    is_snoozed: false,
    ...overrides,
  };
}

const list = (items: Task[], counts = { today: 1, upcoming: 2, overdue: 1, completed: 3, all: 7 }) => ({ ...emptyTaskList, items, counts });

// --- Tasks ------------------------------------------------------------------------------------------------

describe("tasks page", () => {
  it("shows views with counts and task details", async () => {
    mockApi({ routes: { "GET /api/tasks": { status: 200, body: list([task(), task({ id: "t2", title: "Submit report", is_overdue: true, priority: "urgent", due_date: "2026-09-22", due_time: null })]) } } });
    renderApp("/tasks");
    const tabs = await screen.findByRole("tablist", { name: "Task views" });
    // Counts arrive with the data, after the tabs first render.
    expect(await within(tabs).findByRole("tab", { name: /Today\s*1/ })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: /Overdue\s*1/ })).toBeInTheDocument();
    const items = within(await screen.findByRole("list", { name: "Tasks" })).getAllByRole("listitem");
    expect(within(items[0]).getByText("High")).toBeInTheDocument();
    expect(within(items[0]).getByText(/Due .* 18:30/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/Overdue ·/)).toBeInTheDocument();
    expect(within(items[1]).getByText("Urgent")).toBeInTheDocument();
  });

  it("switches views and sends filters", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/tasks/categories": { status: 200, body: ["Home", "Work"] } } });
    const user = userEvent.setup();
    renderApp("/tasks");
    await user.click(await screen.findByRole("tab", { name: /Overdue/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Priority" }), "urgent");
    await screen.findByRole("option", { name: "Work" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Work");
    await user.type(screen.getByRole("searchbox", { name: "Search tasks" }), "report");
    await waitFor(() => {
      const last = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/tasks?")).at(-1)!;
      const params = new URL(last, "http://x").searchParams;
      expect(Object.fromEntries(params)).toEqual({ view: "overdue", priority: "urgent", category: "Work", search: "report" });
    });
  });

  it("creates a recurring task", async () => {
    const fetchMock = mockApi({ routes: { "POST /api/tasks": { status: 201, body: task() } } });
    const user = userEvent.setup();
    renderApp("/tasks?new=1");
    const dialog = await screen.findByRole("dialog", { name: "Add task" });
    await user.type(within(dialog).getByLabelText("Title"), "Water plants");
    await user.type(within(dialog).getByLabelText("Category"), "Home");
    await user.selectOptions(within(dialog).getByLabelText("Priority"), "low");
    await user.type(within(dialog).getByLabelText("Due date"), "2026-09-25");
    await user.type(within(dialog).getByLabelText("Due time"), "07:00");
    await user.selectOptions(within(dialog).getByLabelText("Repeats"), "daily");
    expect(within(dialog).getByText(/next occurrence is created automatically/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    await waitFor(() =>
      expect(sentBody(fetchMock, "POST", "/api/tasks")).toEqual({
        title: "Water plants",
        description: null,
        category: "Home",
        priority: "low",
        status: "not_started",
        due_date: "2026-09-25",
        due_time: "07:00",
        recurrence: "daily",
      }),
    );
  });

  it("validates time and recurrence need a due date", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    renderApp("/tasks?new=1");
    const dialog = await screen.findByRole("dialog", { name: "Add task" });
    await user.type(within(dialog).getByLabelText("Due time"), "09:00");
    await user.selectOptions(within(dialog).getByLabelText("Repeats"), "weekly");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    expect(await within(dialog).findByText("Enter a title.")).toBeInTheDocument();
    expect(within(dialog).getByText("Add a due date to use a time.")).toBeInTheDocument();
    expect(within(dialog).getByText("Recurring tasks need a due date.")).toBeInTheDocument();
    expect(sentBody(fetchMock, "POST", "/api/tasks")).toBeUndefined();
  });

  it("completes a task with the checkbox and changes status from the menu", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/tasks": { status: 200, body: list([task({ recurrence: "daily" })]) },
        "PATCH /api/tasks/t1/status": (init) => ({ status: 200, body: task({ status: JSON.parse(String(init.body)).status }) }),
      },
    });
    const user = userEvent.setup();
    renderApp("/tasks");
    await user.click(await screen.findByRole("checkbox", { name: 'Mark "Pay internet bill" as completed' }));
    await waitFor(() => expect(sentBody(fetchMock, "PATCH", "/api/tasks/t1/status")).toEqual({ status: "completed" }));
    expect(await screen.findByText("Completed. The next occurrence has been added.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions for Pay internet bill" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "In progress" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u, i]) => u === "/api/tasks/t1/status" && i?.method === "PATCH").map(([, i]) => JSON.parse(String(i!.body)).status)).toContain(
        "in_progress",
      ),
    );
  });

  it("deletes a task after confirmation", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/tasks": { status: 200, body: list([task()]) }, "DELETE /api/tasks/t1": { status: 204 } } });
    const user = userEvent.setup();
    renderApp("/tasks");
    await user.click(await screen.findByRole("button", { name: "Actions for Pay internet bill" }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete task" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks/t1", expect.objectContaining({ method: "DELETE" })));
  });

  it('shows "You haven\'t worked on these tasks" grouped by stored status', async () => {
    mockApi({
      routes: {
        "GET /api/tasks/pending": {
          status: 200,
          body: {
            due_soon_days: 3,
            overdue: [task({ id: "a", title: "Renew license", is_overdue: true })],
            due_soon: [task({ id: "b", title: "Book bus ticket" })],
            not_started: [task({ id: "c", title: "Clean room", due_date: null, due_time: null })],
          },
        },
      },
    });
    renderApp("/tasks");
    const card = (await screen.findByText("You haven't worked on these tasks")).closest("[data-slot=card]") as HTMLElement;
    expect(within(card).getByText(/Tasks whose status is still “Not started”/)).toBeInTheDocument();
    expect(within(within(card).getByRole("region", { name: /Overdue/ })).getByText("Renew license")).toBeInTheDocument();
    expect(within(within(card).getByRole("region", { name: /Due in the next 3 days/ })).getByText("Book bus ticket")).toBeInTheDocument();
    expect(within(within(card).getByRole("region", { name: /Not started/ })).getByText("Clean room")).toBeInTheDocument();
  });

  it("hides the pending card when nothing is waiting", async () => {
    mockApi();
    renderApp("/tasks");
    expect(await screen.findByText("Nothing due today.")).toBeInTheDocument();
    expect(screen.queryByText("You haven't worked on these tasks")).not.toBeInTheDocument();
  });
});

// --- Reminders ---------------------------------------------------------------------------------------------

describe("reminders page", () => {
  const reminders = {
    ...emptyReminderList,
    items: [
      reminder({ id: "due", title: "Take medicine", is_due: true, repeat: "daily" }),
      reminder({ id: "custom", title: "Change water filter", repeat: "custom", interval_count: 3, interval_unit: "months" }),
    ],
    counts: { due: 1, upcoming: 1, completed: 0, all: 2 },
  };

  it("shows due reminders, repeat labels and a due banner", async () => {
    mockApi({ routes: { "GET /api/reminders": { status: 200, body: reminders } } });
    renderApp("/reminders");
    expect(await screen.findByText("1 reminder is due now.")).toBeInTheDocument();
    const items = within(await screen.findByRole("list", { name: "Reminders" })).getAllByRole("listitem");
    expect(within(items[0]).getByText("Due now")).toBeInTheDocument();
    expect(within(items[0]).getByText("Daily")).toBeInTheDocument();
    expect(within(items[0]).getByRole("button", { name: /Done for now/ })).toBeInTheDocument();
    expect(within(items[1]).getByText("Every 3 months")).toBeInTheDocument();
  });

  it("creates a custom recurring reminder with a timezone-aware time", async () => {
    const fetchMock = mockApi({ routes: { "POST /api/reminders": { status: 201, body: reminder() } } });
    const user = userEvent.setup();
    renderApp("/reminders?new=1");
    const dialog = await screen.findByRole("dialog", { name: "Add reminder" });
    await user.type(within(dialog).getByLabelText("Title"), "Change water filter");
    await user.clear(within(dialog).getByLabelText("Date"));
    await user.type(within(dialog).getByLabelText("Date"), "2026-10-01");
    await user.clear(within(dialog).getByLabelText("Time"));
    await user.type(within(dialog).getByLabelText("Time"), "09:00");
    await user.selectOptions(within(dialog).getByLabelText("Repeat"), "custom");
    await user.clear(within(dialog).getByLabelText("Number"));
    await user.type(within(dialog).getByLabelText("Number"), "3");
    await user.selectOptions(within(dialog).getByLabelText("Unit"), "months");
    await user.click(within(dialog).getByRole("button", { name: "Add reminder" }));
    await waitFor(() =>
      expect(sentBody(fetchMock, "POST", "/api/reminders")).toEqual({
        title: "Change water filter",
        notes: null,
        remind_at: new Date("2026-10-01T09:00:00").toISOString(),
        repeat: "custom",
        interval_count: 3,
        interval_unit: "months",
      }),
    );
  });

  it("rejects an invalid custom interval", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/reminders?new=1");
    const dialog = await screen.findByRole("dialog", { name: "Add reminder" });
    await user.type(within(dialog).getByLabelText("Title"), "x");
    await user.selectOptions(within(dialog).getByLabelText("Repeat"), "custom");
    await user.clear(within(dialog).getByLabelText("Number"));
    await user.type(within(dialog).getByLabelText("Number"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Add reminder" }));
    expect(await within(dialog).findByText("Use a whole number from 1 to 365.")).toBeInTheDocument();
  });

  it("snoozes and completes", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/reminders": { status: 200, body: reminders },
        "POST /api/reminders/due/snooze": { status: 200, body: reminder({ id: "due", is_snoozed: true, effective_at: "2026-09-25T04:15:00Z" }) },
        "POST /api/reminders/due/complete": { status: 200, body: reminder({ id: "due", repeat: "daily", remind_at: "2026-09-26T03:15:00Z" }) },
      },
    });
    const user = userEvent.setup();
    renderApp("/reminders");
    const first = within(await screen.findByRole("list", { name: "Reminders" })).getAllByRole("listitem")[0];
    await user.click(within(first).getByRole("button", { name: /Snooze/ }));
    await user.click(await screen.findByRole("menuitem", { name: "1 hour" }));
    await waitFor(() => expect(sentBody(fetchMock, "POST", "/api/reminders/due/snooze")).toEqual({ minutes: 60 }));
    expect(await screen.findByText(/Snoozed until/)).toBeInTheDocument();

    await user.click(within(first).getByRole("button", { name: /Done for now/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/reminders/due/complete", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText(/Done\. Next:/)).toBeInTheDocument();
  });

  it("edits with the saved values prefilled", async () => {
    mockApi({ routes: { "GET /api/reminders": { status: 200, body: reminders } } });
    const user = userEvent.setup();
    renderApp("/reminders");
    await user.click(await screen.findByRole("button", { name: "Actions for Change water filter" }));
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit reminder" });
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Change water filter");
    expect(within(dialog).getByLabelText("Repeat")).toHaveValue("custom");
    expect(within(dialog).getByLabelText("Number")).toHaveValue(3);
    expect(within(dialog).getByLabelText("Unit")).toHaveValue("months");
  });
});

// --- Dashboard -------------------------------------------------------------------------------------------------

describe("dashboard integration", () => {
  it("shows real tasks and reminders", async () => {
    mockApi({
      routes: {
        "GET /api/dashboard/summary": {
          status: 200,
          body: {
            ...emptyDashboard,
            tasks: {
              available: true,
              available_from_phase: null,
              today: [{ id: "a", title: "Pay internet bill", due_date: "2026-09-24", due_time: "18:30:00", priority: "urgent", status: "not_started" }],
              pending: [],
              overdue: [{ id: "b", title: "Renew license", due_date: "2026-09-20", due_time: null, priority: "high", status: "in_progress" }],
              counts: { today: 1, pending: 0, overdue: 7 },
            },
            reminders: {
              available: true,
              available_from_phase: null,
              upcoming: [
                { id: "r", title: "Take medicine", remind_at: "2026-09-24T02:00:00Z", is_due: true },
                { id: "s", title: "Dentist", remind_at: "2026-09-27T05:00:00Z", is_due: false },
              ],
              due_count: 1,
            },
          },
        },
      },
    });
    const user = userEvent.setup();
    renderApp("/dashboard");
    expect(await screen.findByText("Pay internet bill")).toBeInTheDocument();
    expect(screen.getByText(/18:30/)).toBeInTheDocument();
    const taskTabs = screen.getByRole("tablist", { name: "Task views" });
    expect(within(taskTabs).getByRole("tab", { name: /Overdue\s*7/ })).toBeInTheDocument(); // full count, not list length
    await user.click(within(taskTabs).getByRole("tab", { name: /Overdue/ }));
    expect(await screen.findByText("Renew license")).toBeInTheDocument();
    expect(screen.getByText("1 due now")).toBeInTheDocument();
    expect(screen.getByText("Due now")).toBeInTheDocument();
    expect(screen.getByText("Dentist")).toBeInTheDocument();
  });
});

// --- Helpers ----------------------------------------------------------------------------------------------------

describe("time helpers", () => {
  it("round-trips local date/time inputs through ISO", () => {
    const iso = fromLocalParts("2026-10-01", "09:00");
    expect(toLocalParts(iso)).toEqual({ date: "2026-10-01", time: "09:00" });
  });

  it("formats repeats and relative times", () => {
    expect(repeatLabel("custom", 1, "weeks")).toBe("Every week");
    expect(repeatLabel("custom", 3, "days")).toBe("Every 3 days");
    expect(repeatLabel("monthly", null, null)).toBe("Monthly");
    const now = Date.parse("2026-09-24T10:00:00Z");
    expect(relativeTime("2026-09-24T13:00:00Z", now)).toBe("in 3 hours");
    expect(relativeTime("2026-09-24T09:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-09-26T10:00:00Z", now)).toBe("in 2 days");
  });

  it("computes tomorrow at 9:00 local", () => {
    const iso = tomorrowMorningIso(new Date(2026, 8, 24, 22, 15));
    const d = new Date(iso);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([25, 9, 0]);
  });
});
