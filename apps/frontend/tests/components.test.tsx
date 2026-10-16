// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChallengeBoard } from "@/components/challenges/challenge-board";
import { LiveScoreboard } from "@/components/scoreboard/live-scoreboard";
import type { ChallengeSummary } from "@/lib/ctfd/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

afterEach(cleanup);

const c = (over: Partial<ChallengeSummary>): ChallengeSummary => ({
  id: 1, name: "Défi", category: "web", value: 100, solves: 0, solvedByMe: false, attempted: false,
  firstBlood: null, firstBloodBy: null, difficulty: null, tags: [], instanced: false, ...over,
});

describe("ChallengeBoard", () => {
  const list = [
    c({ id: 1, name: "Alpha", category: "web", solvedByMe: true }),
    c({ id: 2, name: "Bravo", category: "crypto" }),
    c({ id: 3, name: "Charlie", category: "web", instanced: true, difficulty: "hard" }),
  ];
  it("groupe par catégorie et affiche la progression", () => {
    render(<ChallengeBoard challenges={list} />);
    expect(screen.getByTestId("progress").textContent).toBe("1 / 3 résolus");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.replace(/\d+\/\d+$/, ""))).toEqual(["crypto", "web"]);
    expect(screen.getByText("instance")).toBeTruthy();
  });
  it("affiche l'équipe qui a pris le first blood, et le badge quand c'est la nôtre", () => {
    const by = { accountId: 5, accountName: "Les Premiers", userName: "alice", date: "2026-10-16T08:00:00Z" };
    render(
      <ChallengeBoard
        challenges={[
          c({ id: 1, name: "Alpha", firstBlood: "other", firstBloodBy: by }),
          c({ id: 2, name: "Bravo", firstBlood: "mine", firstBloodBy: { ...by, accountName: "Nous" }, solvedByMe: true }),
          c({ id: 3, name: "Charlie" }),
        ]}
      />,
    );
    const lines = screen.getAllByTestId("first-blood").map((n) => n.textContent);
    expect(lines).toEqual(["First bloodLes Premiers", "First bloodNous"]);
    expect(screen.getAllByText("first blood")).toHaveLength(1); // badge réservé à « mine »
  });
  it("filtre par catégorie, statut et recherche", () => {
    render(<ChallengeBoard challenges={list} />);
    fireEvent.click(screen.getByRole("button", { name: "crypto" }));
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Bravo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tout" }));
    fireEvent.click(screen.getByRole("button", { name: "Résolus" }));
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Charlie")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tous" }));
    fireEvent.change(screen.getByLabelText("Rechercher un challenge"), { target: { value: "char" } });
    expect(screen.getByText("Charlie")).toBeTruthy();
    expect(screen.queryByText("Bravo")).toBeNull();
  });
});

class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data?: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
  close() {
    this.closed = true;
  }
}

describe("LiveScoreboard", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  const entry = (pos: number, name: string, score: number) => ({ pos, accountId: pos, name, score, memberCount: 2 });

  it("affiche l'instantané initial puis se met à jour sur événement SSE", () => {
    render(<LiveScoreboard initial={{ entries: [entry(1, "Red Pandas", 150)], series: [], at: 0 }} highlight="Blue Foxes" />);
    expect(FakeEventSource.last?.url).toBe("/api/scoreboard/stream");
    expect(screen.getAllByTestId("scoreboard-row")).toHaveLength(1);
    act(() => {
      FakeEventSource.last!.emit("open");
      FakeEventSource.last!.emit("scoreboard", { entries: [entry(1, "Blue Foxes", 400), entry(2, "Red Pandas", 150)], series: [], at: 1 });
    });
    const rows = screen.getAllByTestId("scoreboard-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Blue Foxes")).toBeTruthy();
    expect(within(rows[0]!).getByText("toi")).toBeTruthy();
    expect(screen.getByTestId("scoreboard-status").textContent).toContain("direct");
  });
  it("signale un scoreboard non public et ferme le flux", () => {
    render(<LiveScoreboard initial={null} />);
    act(() => FakeEventSource.last!.emit("unavailable", { status: 403 }));
    expect(screen.getByText("Scoreboard non public")).toBeTruthy();
    expect(FakeEventSource.last!.closed).toBe(true);
  });
  it("ferme le flux au démontage", () => {
    const { unmount } = render(<LiveScoreboard initial={null} />);
    const es = FakeEventSource.last!;
    unmount();
    expect(es.closed).toBe(true);
  });
});
