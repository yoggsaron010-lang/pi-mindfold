import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { turnLabel } from "./turn-intent.js";

/** An above-editor menu: it borrows navigation keys, never editor focus. */
export class TurnsDirectory {
  open = false;
  cursor = 0;
  start = 0;
  rowCount = 0;
  constructor(controller) { this.controller = controller; }

  toggle() {
    if (this.open) { this.close(); return; }
    this.controller.refreshTurnTitles();
    const { store, tui } = this.controller;
    if (!store.groups.length || !tui) return;
    this.open = true;
    this.cursor = Math.max(0, store.groups.indexOf(store.selected ?? store.current));
    this.removeInput = tui.addInputListener?.((data) => this.handleInput(data));
    this.controller.changed();
  }

  close() {
    this.open = false;
    this.rowCount = 0;
    this.removeInput?.();
    this.removeInput = undefined;
    this.controller.changed();
  }

  move(delta) {
    this.cursor = Math.max(0, Math.min(this.controller.store.groups.length - 1, this.cursor + delta));
    this.controller.changed();
  }

  choose(index = this.cursor) {
    const group = this.controller.store.groups[index];
    this.close();
    if (group) this.controller.selectGroup(group);
  }

  handleInput(data) {
    if (!this.open || this.controller.tui.hasOverlay?.()) return;
    if (matchesKey(data, "escape")) this.close();
    else if (matchesKey(data, "up")) this.move(-1);
    else if (matchesKey(data, "down")) this.move(1);
    else if (matchesKey(data, "enter")) this.choose();
    else {
      // Mouse input must reach the menu. Ordinary typing closes it and passes
      // through to the editor, including paste and non-Latin input.
      if (!data.startsWith("\x1b[<")) this.close();
      return;
    }
    return { consume: true };
  }

  render(width) {
    if (!this.open || width <= 0) { this.rowCount = 0; return []; }
    const { store, tui, theme } = this.controller;
    const count = Math.min(8, Math.max(1, (tui.terminal?.rows ?? 24) - 8), store.groups.length);
    this.cursor = Math.max(0, Math.min(this.cursor, store.groups.length - 1));
    this.start = Math.max(0, Math.min(this.cursor - Math.floor(count / 2), store.groups.length - count));
    const lines = [theme.fg("muted", `─ Turn History (${this.cursor + 1}/${store.groups.length}) ─`)];
    for (let index = this.start; index < this.start + count; index++) {
      const group = store.groups[index];
      const current = group === (store.selected ?? store.current) ? "●" : " ";
      const row = `${index === this.cursor ? "›" : " "} ${current} ${group.id}  ${turnLabel(group)}`;
      lines.push(theme.fg(index === this.cursor ? "accent" : "muted", row));
    }
    lines.push(theme.fg("muted", "↑/↓ · Enter · Esc"));
    this.rowCount = lines.length;
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }

  handleMouse(event) {
    if (!this.open || event.y >= this.rowCount) return;
    if (event.type === "wheel" && event.wheelDelta) {
      this.move(event.wheelDelta < 0 ? -1 : 1);
      return { handled: true };
    }
    if (event.button !== "left" || !["press", "release", "click"].includes(event.type)) return;
    const index = this.start + event.y - 1;
    if (event.type === "click" && event.y > 0 && event.y < this.rowCount - 1) this.choose(index);
    return { handled: true };
  }
}
