"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Dialog } from "./dialog.tsx";

export type Command = {
  readonly id: string;
  readonly label: string;
  /** Where the command belongs, such as "Go to" or "Organization". */
  readonly group: string;
  /** More words that should find it. */
  readonly keywords?: string;
  readonly run: () => void;
};

/** Commands whose words contain every word typed, in any order. */
export function matchCommands(
  commands: readonly Command[],
  query: string,
): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter((command) => {
    const text =
      `${command.label} ${command.group} ${command.keywords ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * The Ctrl+K palette: a search box over a list of commands. Arrow keys move
 * through the list, Enter runs the highlighted command, and Escape closes.
 * Screen readers hear the highlighted command through aria-activedescendant,
 * while focus stays in the box.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: readonly Command[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const matches = useMemo(
    () => matchCommands(commands, query),
    [commands, query],
  );
  const highlighted = matches[Math.min(active, matches.length - 1)];
  const optionId = (command: Command) => `${listId}-${command.id}`;
  const highlightedId = highlighted ? optionId(highlighted) : undefined;

  // aria-activedescendant doesn't scroll the list, so the highlighted
  // command is scrolled into view whenever it changes.
  useEffect(() => {
    if (!open || !highlightedId) return;
    document
      .getElementById(highlightedId)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlightedId]);

  // However it closes, the palette opens next time with an empty search.
  const close = useCallback(() => {
    setQuery("");
    setActive(0);
    onClose();
  }, [onClose]);

  function run(command: Command) {
    close();
    command.run();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const last = matches.length - 1;
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(active + 1, last),
      ArrowUp: () => Math.max(active - 1, 0),
      Home: () => 0,
      End: () => last,
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setActive(move());
    } else if (event.key === "Enter" && highlighted) {
      event.preventDefault();
      run(highlighted);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Commands"
      className="palette"
      initialFocus={input}
    >
      <label htmlFor={inputId}>Search commands</label>
      <input
        ref={input}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={highlightedId}
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" aria-label="Commands">
        {matches.map((command, index) => (
          // The search box handles the keyboard for the list, as the combobox
          // pattern does, so the options only need the pointer.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
          <li
            key={command.id}
            id={optionId(command)}
            role="option"
            aria-selected={command === highlighted}
            onClick={() => run(command)}
            onMouseMove={() => setActive(index)}
          >
            <span>{command.label}</span>
            <span className="palette-group">{command.group}</span>
          </li>
        ))}
      </ul>
      <p role="status" className="hint">
        {matches.length === 0 ? "No commands match." : ""}
      </p>
    </Dialog>
  );
}
