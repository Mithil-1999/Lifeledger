import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, CalendarItem } from "@/features/calendar/api";
import { addMonths, itemsByDay, rangeLabel, shiftAnchor, viewRange } from "@/features/calendar/dates";
import { mockApi, renderApp, sentBody } from "./utils";

afterEach(() => vi.unstubAllGlobals());

function item(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    key: "event:e1:2026-09-24",
    source: "event",
    source_id: "e1",
    title: "Dentist appointment",
    date: "2026-09-24",
    end_date: "2026-09-24",
    start_time: "10:30:00",
    end_time: "11:15:00",
    all_day: false,
    kind: "appointment",
    category: "health",
    status: null,
    is_done: false,
    is_overdue: false,
    is_projected: false,
    description: "Bring the X-ray",
    location: "Kathmandu Dental",
    amount: null,
    currency: null,
    priority: null,
    recurrence: null,
    reminder_minutes: 60,
    ...overrides,
  };
}

const taskItem = item({
  key: "task:t1:2026-09-24",
  source: "task",
  source_id: "t1",
  title: "Submit report",
  start_time: "17:00:00",
  end_time: null,
  kind: "task",
  category: "Work",
  status: "not_started",
  is_overdue: true,
  description: null,
  location: null,
  priority: "high",
  reminder_minutes: null,
});

const billItem = item({
  key: "bill:b1:2026-09-26",
  source: "bill",
  source_id: "b1",
  title: "Wi-Fi",
  date: "2026-09-26",
  end_date: "2026-09-26",
  start_time: null,
  end_time: null,
  all_day: true,
  kind: "bill",
  category: "wifi",
  status: "pending",
  description: null,
  location: null,
  amount: "1500.00",
  currency: "NPR",
  reminder_minutes: null,
});

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "e1",
    title: "Dentist appointment",
    description: "Bring the X-ray",
    location: "Kathmandu Dental",
    event_type: "appointment",
    category: "health",
    start_date: "2026-09-24",
    end_date: "2026-09-24",
    start_time: "10:30:00",
    end_time: "11:15:00",
    all_day: false,
    recurrence: null,
    reminder_minutes: 60,
    reminder_id: "r1",
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

const feedRoute = (items: CalendarItem[]) => (init: { url: string }) => {
  const params = new URL(init.url, "http://x").searchParams;
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.source] = (counts[i.source] ?? 0) + 1;
  return { status: 200, body: { start: params.get("start"), end: params.get("end"), today: "2026-09-24", items, counts } };
};

const calendarCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/calendar?"));

const lastParams = (fetchMock: ReturnType<typeof mockApi>) => new URL(calendarCalls(fetchMock).at(-1)!, "http://x").searchParams;

// --- Date helpers -----------------------------------------------------------------------------------------------------

describe("calendar dates", () => {
  it("computes the range each view shows", () => {
    // 1 Sep 2026 is a Tuesday: the month grid starts on Sunday 30 Aug and shows six weeks.
    expect(viewRange("month", "2026-09-24")).toEqual({ start: "2026-08-30", end: "2026-10-10" });
    expect(viewRange("week", "2026-09-24")).toEqual({ start: "2026-09-20", end: "2026-09-26" });
    expect(viewRange("day", "2026-09-24")).toEqual({ start: "2026-09-24", end: "2026-09-24" });
    expect(viewRange("agenda", "2026-09-24")).toEqual({ start: "2026-09-24", end: "2026-10-23" });
  });

  it("moves between periods without date drift", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(shiftAnchor("week", "2026-09-24", -1)).toBe("2026-09-17");
    expect(shiftAnchor("day", "2026-12-31", 1)).toBe("2027-01-01");
    expect(rangeLabel("month", "2026-09-24")).toBe("September 2026");
    expect(rangeLabel("week", "2026-12-30")).toBe("27 Dec 2026 – 2 Jan 2027");
  });

  it("spreads multi-day items over each day they cover, clipped to the range", () => {
    const trip = item({ key: "trip", date: "2026-09-29", end_date: "2026-10-03" });
    const byDay = itemsByDay([trip], "2026-09-30", "2026-10-02");
    expect([...byDay.keys()]).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});

// --- Page ----------------------------------------------------------------------------------------------------------------

describe("calendar page", () => {
  it("shows events, tasks and bills together in the month view", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/calendar": feedRoute([item(), taskItem, billItem]) } });
    const user = userEvent.setup();
    renderApp("/calendar?view=month&date=2026-09-24");

    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    await waitFor(() => expect(lastParams(fetchMock).get("start")).toBe("2026-08-30"));
    expect(lastParams(fetchMock).get("end")).toBe("2026-10-10");
    expect(lastParams(fetchMock).has("sources")).toBe(false); // everything by default

    const days = await screen.findByRole("list", { name: "Days of the month" });
    const today = within(days).getByRole("button", { name: /Thursday, 24 September 2026, today: 2 items/ });
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(within(days).getByRole("button", { name: /Saturday, 26 September 2026: 1 item/ })).toBeInTheDocument();

    // The selected day's list (also what phones use) has full details.
    const selected = screen.getByRole("heading", { name: /Thursday, 24 September 2026/ }).parentElement!;
    expect(within(selected).getByRole("button", { name: /Appointment, Dentist appointment, 10:30–11:15/ })).toBeInTheDocument();
    expect(within(selected).getByRole("button", { name: /Task, Submit report, 17:00, overdue/ })).toBeInTheDocument();

    await user.click(within(days).getByRole("button", { name: /Saturday, 26 September 2026/ }));
    const bill = await screen.findByRole("heading", { name: /Saturday, 26 September 2026/ });
    expect(within(bill.parentElement!).getByText(/NPR\s*1,500\.00/)).toBeInTheDocument();

    // Source filter chips show counts.
    const chips = screen.getByRole("group", { name: "Show on calendar" });
    expect(within(chips).getByRole("button", { name: /Tasks\s*1/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches between month, week, day and agenda views", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/calendar": feedRoute([item()]) } });
    const user = userEvent.setup();
    const { router } = renderApp("/calendar?date=2026-09-24");
    await screen.findByRole("heading", { name: "September 2026" });

    await user.click(screen.getByRole("tab", { name: "Week" }));
    expect(await screen.findByRole("heading", { name: /^20 Sept? – 26 Sept? 2026$/ })).toBeInTheDocument();
    await waitFor(() => expect(lastParams(fetchMock).get("start")).toBe("2026-09-20"));
    expect(lastParams(fetchMock).get("end")).toBe("2026-09-26");
    expect(within(screen.getByRole("list", { name: "Days of the week" })).getAllByRole("listitem", { name: "" }).length).toBeGreaterThanOrEqual(7);

    await user.click(screen.getByRole("button", { name: "Next week" }));
    await screen.findByRole("heading", { name: /^27 Sept? – 3 Oct 2026$/ });
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await screen.findByRole("heading", { name: /^20 Sept? – 26 Sept? 2026$/ });

    // Opening a day from the week goes to the day view.
    await user.click(screen.getByRole("button", { name: /Open Thursday, 24 September 2026, today/ }));
    expect(await screen.findByRole("heading", { level: 2, name: /^Thursday, 24 September 2026\s*·\s*Today$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(router.state.location.search).toContain("view=day");

    await user.click(screen.getByRole("tab", { name: "Agenda" }));
    await waitFor(() => expect(lastParams(fetchMock).get("end")).toBe("2026-10-23"));
    expect(await screen.findByRole("list", { name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dentist appointment/ })).toBeInTheDocument();
  });

  it("goes back to today", async () => {
    mockApi({ routes: { "GET /api/calendar": feedRoute([]) } });
    const user = userEvent.setup();
    renderApp("/calendar?view=month&date=2027-03-10");
    await screen.findByRole("heading", { name: "March 2027" });
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();
  });

  it("sends search, category and source filters", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/calendar": feedRoute([item()]) } });
    const user = userEvent.setup();
    renderApp("/calendar?view=agenda&date=2026-09-24");
    await screen.findByRole("list", { name: "Agenda" });

    await user.type(screen.getByRole("searchbox", { name: "Search calendar" }), "dentist");
    await waitFor(() => expect(lastParams(fetchMock).get("search")).toBe("dentist"));
    expect(await screen.findByText("1 match in this 30 days.")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Event category" }), "health");
    await waitFor(() => expect(lastParams(fetchMock).get("category")).toBe("health"));

    const chips = screen.getByRole("group", { name: "Show on calendar" });
    await user.click(within(chips).getByRole("button", { name: /Bills/ }));
    await waitFor(() => expect(lastParams(fetchMock).get("sources")).toBe("event,task,reminder,goal"));
    expect(within(chips).getByRole("button", { name: /Bills/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("asks for at least one type when every source is hidden", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/calendar": feedRoute([]) } });
    const user = userEvent.setup();
    renderApp("/calendar?view=agenda&date=2026-09-24");
    await screen.findByText("Nothing scheduled in this period.");
    const chips = screen.getByRole("group", { name: "Show on calendar" });
    for (const name of [/Events/, /Tasks/, /Reminders/, /Bills/, /Goal deadlines/]) {
      await user.click(within(chips).getByRole("button", { name }));
    }
    expect(await screen.findByText("Choose at least one type to show.")).toBeInTheDocument();
    const before = calendarCalls(fetchMock).length;
    await new Promise((r) => setTimeout(r, 50));
    expect(calendarCalls(fetchMock).length).toBe(before);
  });

  it("creates an all-day event on the selected day", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/calendar": feedRoute([]),
        "POST /api/calendar/events": { status: 201, body: event({ id: "e2", title: "Mom's birthday", all_day: true, reminder_minutes: 1440, reminder_id: "r9" }) },
      },
    });
    const user = userEvent.setup();
    renderApp("/calendar?view=day&date=2026-10-05");
    await user.click(await screen.findByRole("button", { name: "Add event this day" }));
    const dialog = await screen.findByRole("dialog", { name: "Add event" });
    expect(within(dialog).getByLabelText("Starts")).toHaveValue("2026-10-05");
    await user.type(within(dialog).getByLabelText("Title"), "Mom's birthday");
    await user.selectOptions(within(dialog).getByLabelText("Category"), "family");
    await user.selectOptions(within(dialog).getByLabelText("Repeats"), "yearly");
    await user.selectOptions(within(dialog).getByLabelText("Remind me"), "1440");
    await user.click(within(dialog).getByRole("button", { name: "Add event" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sentBody(fetchMock, "POST", "/api/calendar/events")).toEqual({
      title: "Mom's birthday",
      description: null,
      location: null,
      event_type: "personal",
      category: "family",
      start_date: "2026-10-05",
      end_date: null,
      start_time: null,
      end_time: null,
      recurrence: "yearly",
      reminder_minutes: 1440,
    });
    expect(await screen.findByText("Event added.")).toBeInTheDocument();
  });

  it("creates a timed appointment and validates times", async () => {
    const fetchMock = mockApi({
      routes: { "GET /api/calendar": feedRoute([]), "POST /api/calendar/events": { status: 201, body: event() } },
    });
    const user = userEvent.setup();
    renderApp("/calendar?view=month&date=2026-09-24");
    await user.click(await screen.findByRole("button", { name: "Add event" }));
    const dialog = await screen.findByRole("dialog", { name: "Add event" });
    await user.type(within(dialog).getByLabelText("Title"), "Dentist");
    await user.selectOptions(within(dialog).getByLabelText("Type"), "appointment");
    await user.click(within(dialog).getByLabelText("All-day"));

    // Timed events need a start time; end time can't be before it.
    await user.click(within(dialog).getByRole("button", { name: "Add event" }));
    expect(await within(dialog).findByText("Choose a start time, or make it all-day.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Start time"), "10:30");
    await user.type(within(dialog).getByLabelText("End time"), "09:00");
    await user.click(within(dialog).getByRole("button", { name: "Add event" }));
    expect(await within(dialog).findByText("The end time can't be before the start time.")).toBeInTheDocument();
    expect(sentBody(fetchMock, "POST", "/api/calendar/events")).toBeUndefined();

    await user.clear(within(dialog).getByLabelText("End time"));
    await user.type(within(dialog).getByLabelText("End time"), "11:15");
    await user.type(within(dialog).getByLabelText("Location"), "Kathmandu Dental");
    await user.click(within(dialog).getByRole("button", { name: "Add event" }));
    await waitFor(() => expect(sentBody(fetchMock, "POST", "/api/calendar/events")).toMatchObject({
      title: "Dentist",
      event_type: "appointment",
      start_date: "2026-09-24",
      start_time: "10:30",
      end_time: "11:15",
      location: "Kathmandu Dental",
      reminder_minutes: null,
    }));
  });

  it("shows the server's error when saving fails", async () => {
    mockApi({
      routes: {
        "GET /api/calendar": feedRoute([]),
        "POST /api/calendar/events": { status: 422, body: { detail: "An event can last at most a year." } },
      },
    });
    const user = userEvent.setup();
    renderApp("/calendar?view=month&date=2026-09-24");
    await user.click(await screen.findByRole("button", { name: "Add event" }));
    const dialog = await screen.findByRole("dialog", { name: "Add event" });
    await user.type(within(dialog).getByLabelText("Title"), "Long trip");
    await user.click(within(dialog).getByRole("button", { name: "Add event" }));
    expect(await within(dialog).findByText("An event can last at most a year.")).toBeInTheDocument();
  });

  it("opens event details and edits the event", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/calendar": feedRoute([item()]),
        "GET /api/calendar/events/e1": { status: 200, body: event() },
        "PUT /api/calendar/events/e1": { status: 200, body: event({ title: "Dentist (moved)" }) },
      },
    });
    const user = userEvent.setup();
    renderApp("/calendar?view=day&date=2026-09-24");
    await user.click(await screen.findByRole("button", { name: /Appointment, Dentist appointment/ }));

    const details = await screen.findByRole("dialog", { name: "Dentist appointment" });
    expect(within(details).getByText("Kathmandu Dental")).toBeInTheDocument();
    expect(within(details).getByText("Reminder: 1 hour before")).toBeInTheDocument();
    expect(within(details).getByText("Bring the X-ray")).toBeInTheDocument();
    await user.click(within(details).getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit event" });
    const title = await within(dialog).findByLabelText("Title");
    expect(title).toHaveValue("Dentist appointment");
    expect(within(dialog).getByLabelText("Start time")).toHaveValue("10:30");
    expect(within(dialog).getByLabelText("Remind me")).toHaveValue("60");
    await user.clear(title);
    await user.type(title, "Dentist (moved)");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(sentBody(fetchMock, "PUT", "/api/calendar/events/e1")).toMatchObject({
      title: "Dentist (moved)",
      start_time: "10:30",
      end_time: "11:15",
      reminder_minutes: 60,
      category: "health",
    }));
    expect(await screen.findByText("Event updated.")).toBeInTheDocument();
  });

  it("edits a repeating series from its first date", async () => {
    const repeat = item({ key: "event:e1:2026-10-01", date: "2026-10-01", end_date: "2026-10-01", recurrence: "weekly", is_projected: true });
    const fetchMock = mockApi({
      routes: {
        "GET /api/calendar": feedRoute([repeat]),
        "GET /api/calendar/events/e1": { status: 200, body: event({ recurrence: "weekly" }) },
        "PUT /api/calendar/events/e1": { status: 200, body: event({ recurrence: "weekly" }) },
      },
    });
    const user = userEvent.setup();
    renderApp("/calendar?view=day&date=2026-10-01");
    await user.click(await screen.findByRole("button", { name: /Dentist appointment/ }));
    const details = await screen.findByRole("dialog", { name: "Dentist appointment" });
    expect(within(details).getByText(/upcoming repeat/)).toBeInTheDocument();
    await user.click(within(details).getByRole("button", { name: "Edit series" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit event" });
    expect(await within(dialog).findByLabelText("Starts")).toHaveValue("2026-09-24");
    expect(within(dialog).getByText(/Changes apply to every occurrence/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sentBody(fetchMock, "PUT", "/api/calendar/events/e1")).toMatchObject({ start_date: "2026-09-24", recurrence: "weekly" }));
  });

  it("deletes an event after confirmation", async () => {
    const fetchMock = mockApi({
      routes: { "GET /api/calendar": feedRoute([item()]), "DELETE /api/calendar/events/e1": { status: 204 } },
    });
    const user = userEvent.setup();
    renderApp("/calendar?view=agenda&date=2026-09-24");
    await user.click(await screen.findByRole("button", { name: /Dentist appointment/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Dentist appointment" })).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete “Dentist appointment”?" });
    expect(within(confirm).getByText(/its reminder will be permanently deleted/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Delete event" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => u === "/api/calendar/events/e1" && i?.method === "DELETE")).toBe(true));
    expect(await screen.findByText("Event deleted.")).toBeInTheDocument();
  });

  it("links tasks and bills to their own module instead of editing copies", async () => {
    mockApi({ routes: { "GET /api/calendar": feedRoute([taskItem]) } });
    const user = userEvent.setup();
    const { router } = renderApp("/calendar?view=day&date=2026-09-24");
    await user.click(await screen.findByRole("button", { name: /Task, Submit report/ }));
    const details = await screen.findByRole("dialog", { name: "Submit report" });
    expect(within(details).getByText(/From Tasks/)).toBeInTheDocument();
    expect(within(details).getByText("Overdue")).toBeInTheDocument();
    expect(within(details).getByText("High priority")).toBeInTheDocument();
    expect(within(details).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    await user.click(within(details).getByRole("link", { name: "Open in Tasks" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/tasks"));
  });

  it("shows an error with retry when the calendar can't load", async () => {
    let fail = true;
    mockApi({
      routes: {
        "GET /api/calendar": (init) => (fail ? { status: 500, body: { detail: "Server error." } } : feedRoute([item()])(init)),
      },
    });
    const user = userEvent.setup();
    renderApp("/calendar?view=day&date=2026-09-24");
    expect(await screen.findByText(/Couldn't load the calendar/)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /Dentist appointment/ })).toBeInTheDocument();
  });
});
