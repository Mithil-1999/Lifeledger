import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppNotification } from "@/features/notifications/api";
import { timeAgo } from "@/features/notifications/constants";
import { defaultNotificationPreferences, mockApi, renderApp, sentBody } from "./utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

function note(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n1",
    type: "bill_overdue",
    title: "Overdue bill: Wi-Fi",
    message: "NPR 1,500.00 was due Mon 21 Sep 2026 and hasn't been marked as paid.",
    related_type: "bill",
    related_id: "b1",
    is_read: false,
    read_at: null,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

const list = (items: AppNotification[]) => ({ status: 200, body: { items, total: items.length, unread_count: items.filter((n) => !n.is_read).length } });

const calls = (fetchMock: ReturnType<typeof mockApi>, method: string, prefix: string) =>
  fetchMock.mock.calls.filter(([u, i]) => String(u).startsWith(prefix) && (i?.method ?? "GET").toUpperCase() === method).map(([u]) => String(u));

/** A fake browser Notification API. */
function stubBrowserNotifications(permission: NotificationPermission, requestResult: NotificationPermission = permission) {
  const shown: { title: string; options?: NotificationOptions }[] = [];
  const Fake = vi.fn(function (this: unknown, title: string, options?: NotificationOptions) {
    shown.push({ title, options });
    return { close: vi.fn(), onclick: null };
  }) as unknown as typeof Notification & { permission: NotificationPermission; requestPermission: () => Promise<NotificationPermission> };
  Fake.permission = permission;
  Fake.requestPermission = vi.fn(async () => {
    Fake.permission = requestResult;
    return requestResult;
  });
  vi.stubGlobal("Notification", Fake);
  return { shown, Fake };
}

describe("notification helpers", () => {
  it("formats relative times", () => {
    const now = Date.parse("2026-09-24T12:00:00Z");
    expect(timeAgo("2026-09-24T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-09-24T11:55:00Z", now)).toBe("5 minutes ago");
    expect(timeAgo("2026-09-24T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-09-23T12:00:00Z", now)).toBe("yesterday");
    expect(timeAgo("2026-08-01T12:00:00Z", now)).toBe("1 Aug 2026");
  });
});

describe("notification bell", () => {
  it("shows the unread count, runs a check, and opens the related page", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/notifications": list([note(), note({ id: "n2", type: "savings_milestone", title: "50% of your savings goal: Laptop", related_type: "savings_goal", is_read: true })]),
        "PATCH /api/notifications/n1": { status: 200, body: note({ is_read: true }) },
      },
    });
    const user = userEvent.setup();
    const { router } = renderApp("/dashboard");
    const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    await waitFor(() => expect(calls(fetchMock, "POST", "/api/notifications/check")).toHaveLength(1));

    await user.click(bell);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("50% of your savings goal: Laptop")).toBeInTheDocument();
    expect(within(menu).getAllByText("5 minutes ago")).toHaveLength(2);
    await user.click(within(menu).getByText("Overdue bill: Wi-Fi"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/bills"));
    expect(sentBody(fetchMock, "PATCH", "/api/notifications/n1")).toEqual({ read: true });
  });

  it("marks everything read from the bell", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/notifications": list([note()]), "POST /api/notifications/read-all": { status: 200, body: { count: 1 } } } });
    const user = userEvent.setup();
    renderApp("/dashboard");
    await user.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    await user.click(await screen.findByRole("button", { name: /Mark all read/ }));
    await waitFor(() => expect(calls(fetchMock, "POST", "/api/notifications/read-all")).toHaveLength(1));
  });

  it("says when you're caught up", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/dashboard");
    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  });

  it("shows a browser notification only for new notifications, once", async () => {
    const { shown } = stubBrowserNotifications("granted");
    let items = [note({ id: "old", title: "Already here" })];
    mockApi({
      routes: {
        "GET /api/notifications": () => list(items),
        "GET /api/notifications/preferences": { status: 200, body: { ...defaultNotificationPreferences, browser_enabled: true } },
      },
    });
    const { queryClient } = renderApp("/dashboard");
    await screen.findByRole("button", { name: "Notifications, 1 unread" });
    await act(() => queryClient.invalidateQueries({ queryKey: ["notifications", "preferences"] }));
    expect(shown).toHaveLength(0); // existing notifications aren't re-announced

    items = [note({ id: "new", title: "Reminder: Take medicine", message: "After food", type: "reminder_due", related_type: "reminder" }), ...items];
    await act(() => queryClient.invalidateQueries({ queryKey: ["notifications", "list"] }));
    await waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0]).toEqual({ title: "Reminder: Take medicine", options: { body: "After food", tag: "lifevault-new", icon: "/favicon.svg" } });
    await act(() => queryClient.invalidateQueries({ queryKey: ["notifications", "list"] }));
    expect(shown).toHaveLength(1);
  });

  it("doesn't show browser notifications when they're turned off", async () => {
    const { shown } = stubBrowserNotifications("granted");
    let items: AppNotification[] = [];
    mockApi({ routes: { "GET /api/notifications": () => list(items) } });
    const { queryClient } = renderApp("/dashboard");
    await screen.findByRole("button", { name: "Notifications" });
    items = [note()];
    await act(() => queryClient.invalidateQueries({ queryKey: ["notifications", "list"] }));
    await screen.findByRole("button", { name: "Notifications, 1 unread" });
    expect(shown).toHaveLength(0);
  });
});

describe("notifications page", () => {
  it("lists notifications with filters and per-item actions", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/notifications": list([note(), note({ id: "n2", type: "task_overdue", title: "Overdue task: Report", related_type: "task", is_read: true })]),
        "PATCH /api/notifications/n2": { status: 200, body: note({ id: "n2" }) },
        "DELETE /api/notifications/n1": { status: 204 },
      },
    });
    const user = userEvent.setup();
    renderApp("/notifications");
    const items = within(await screen.findByRole("list", { name: "Notifications" })).getAllByRole("listitem");
    expect(within(items[0]).getByText("New")).toBeInTheDocument();
    expect(within(items[0]).getByRole("link", { name: "Open Bills" })).toHaveAttribute("href", "/bills");
    expect(within(items[1]).getByRole("link", { name: "Open Tasks" })).toHaveAttribute("href", "/tasks");

    await user.click(within(items[1]).getByRole("button", { name: "Actions for Overdue task: Report" }));
    await user.click(await screen.findByRole("menuitem", { name: /Mark as unread/ }));
    await waitFor(() => expect(sentBody(fetchMock, "PATCH", "/api/notifications/n2")).toEqual({ read: false }));

    await user.click(within(items[0]).getByRole("button", { name: "Actions for Overdue bill: Wi-Fi" }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await waitFor(() => expect(calls(fetchMock, "DELETE", "/api/notifications/n1")).toHaveLength(1));

    await user.click(screen.getByRole("tab", { name: /Unread/ }));
    await waitFor(() => expect(calls(fetchMock, "GET", "/api/notifications?").at(-1)).toContain("status=unread"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Notification type" }), "bill_overdue");
    await waitFor(() => expect(calls(fetchMock, "GET", "/api/notifications?").at(-1)).toContain("type=bill_overdue"));
  });

  it("marks all read and deletes read notifications", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/notifications": list([note()]),
        "POST /api/notifications/read-all": { status: 200, body: { count: 1 } },
        "POST /api/notifications/dismiss-read": { status: 200, body: { count: 3 } },
      },
    });
    const user = userEvent.setup();
    renderApp("/notifications");
    await screen.findByRole("list", { name: "Notifications" });
    await user.click(within(screen.getByRole("main")).getByRole("button", { name: /Mark all read/ }));
    expect(await screen.findByText("Marked 1 as read.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Delete read/ }));
    expect(await screen.findByText("Deleted 3 read notifications.")).toBeInTheDocument();
    expect(calls(fetchMock, "POST", "/api/notifications/dismiss-read")).toHaveLength(1);
  });

  it("shows an empty state", async () => {
    mockApi();
    renderApp("/notifications");
    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
  });

  it("saves notification preferences", async () => {
    const fetchMock = mockApi({
      routes: { "PUT /api/notifications/preferences": (init) => ({ status: 200, body: { ...JSON.parse(String(init.body)), updated_at: "2026-09-25T00:00:00Z" } }) },
    });
    const user = userEvent.setup();
    renderApp("/notifications");
    const save = await screen.findByRole("button", { name: "Save settings" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Overdue tasks/ }));
    await user.selectOptions(screen.getByLabelText("Upcoming bills"), "7");
    await user.click(screen.getByRole("checkbox", { name: /Upcoming tasks/ }));
    expect(screen.getByLabelText("Upcoming tasks")).toBeDisabled();
    await user.click(save);
    await waitFor(() =>
      expect(sentBody(fetchMock, "PUT", "/api/notifications/preferences")).toEqual({ ...defaultNotificationPreferences, updated_at: undefined, task_overdue: false, task_upcoming: false, bill_lead_days: 7 }),
    );
    expect(await screen.findByText("Notification settings saved.")).toBeInTheDocument();
  });

  it("asks the browser for permission before enabling browser notifications", async () => {
    const { Fake } = stubBrowserNotifications("default", "granted");
    const fetchMock = mockApi({
      routes: { "PUT /api/notifications/preferences": (init) => ({ status: 200, body: { ...JSON.parse(String(init.body)), updated_at: "2026-09-25T00:00:00Z" } }) },
    });
    const user = userEvent.setup();
    renderApp("/notifications");
    const box = await screen.findByRole("checkbox", { name: /Show system notifications/ });
    expect(screen.getByText("Your browser will ask for permission when you turn this on.")).toBeInTheDocument();
    await user.click(box);
    expect(Fake.requestPermission).toHaveBeenCalled();
    expect(box).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Send a test notification" }));
    expect(Fake).toHaveBeenCalledWith("LifeVault test notification", expect.objectContaining({ tag: "lifevault-test" }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect((sentBody(fetchMock, "PUT", "/api/notifications/preferences") as { browser_enabled: boolean }).browser_enabled).toBe(true));
  });

  it("keeps browser notifications off when permission is denied or unsupported", async () => {
    stubBrowserNotifications("default", "denied");
    mockApi();
    const user = userEvent.setup();
    const { unmount } = renderApp("/notifications");
    const box = await screen.findByRole("checkbox", { name: /Show system notifications/ });
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(await screen.findByText("Notifications are blocked for this site in your browser.")).toBeInTheDocument();
    unmount();

    vi.unstubAllGlobals();
    // Simulate a browser without the Notification API.
    const original = Object.getOwnPropertyDescriptor(window, "Notification");
    // @ts-expect-error - removing the API for this test
    delete window.Notification;
    try {
      mockApi();
      renderApp("/notifications");
      expect(await screen.findByRole("checkbox", { name: /Show system notifications/ })).toBeDisabled();
      expect(screen.getByText(/This browser doesn't support notifications/)).toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(window, "Notification", original);
    }
  });
});
