// The machines Herdr knows besides this computer (`hc machine ls`), and
// connecting again to one that was rebuilt or replaced. Taken from the stock
// spaces mod.

import { hc } from "herdr";
import { tr } from "./i18n/i18n.js";

const KEY = "machines.reconnecting";

export class Machines {
  constructor() {
    this.list = [];
    // name -> { machine, removed, busy, error }: a reconnect under way, kept
    // across restarts so one stopped halfway can go on.
    this.reconnecting = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.list = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary);
      } catch {
        // hc couldn't run: keep the last list
      }
      cx.notify();
    });
  }

  // Every machine name to offer, null (this computer) first.
  names(spaceMachines) {
    return [null, ...[...new Set([...spaceMachines.filter(Boolean), ...this.list.map((m) => m.name), ...Object.keys(this.reconnecting)])].sort()];
  }

  get(name) {
    return this.list.find((m) => m.name === name) ?? this.reconnecting[name]?.machine ?? null;
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  save() {
    localStorage.setItem(KEY, JSON.stringify(this.reconnecting));
  }

  // Forgets the machine and adds it again under the same name.
  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    this.save();
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const ask = async (args) => {
          const r = await hc([...args, "--json"]);
          if (r.code === 0) return;
          let error;
          try {
            error = JSON.parse(r.stdout || r.stderr).error?.message;
          } catch {
            // not JSON: the raw text below says what went wrong
          }
          throw new Error(error || r.stderr || r.stdout || tr("Couldn't connect."));
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          this.save();
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      this.save();
      this.refresh(cx);
      cx.notify();
    });
  }
}
