import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type MouseEvent,
} from 'react';
import { useViewer } from '@/store/viewerStore';
import type { LoadedModel, ModelNode } from '@/core/types';
import { useNumberFormat, useT } from '@/i18n';
import {
  ChevronRightIcon, EyeIcon, EyeOffIcon, SearchIcon, TransparencyIcon,
} from '@/components/ui/icons';

/** Fixed row height — the tree is virtualized, only visible rows render. */
const ROW_HEIGHT = 26;
const OVERSCAN = 8;

interface FlatRow {
  node: ModelNode;
  depth: number;
  parentHidden: boolean;
  expanded: boolean;
}

/** Nodes that match the query, or contain a match — shown while searching. */
function collectMatches(node: ModelNode, query: string, out: Set<string>): boolean {
  const selfMatch = node.name.toLowerCase().includes(query);
  let childMatch = false;
  for (const child of node.children) {
    childMatch = collectMatches(child, query, out) || childMatch;
  }
  if (selfMatch || childMatch) {
    out.add(node.id);
    return true;
  }
  return false;
}

function defaultExpanded(model: LoadedModel): Set<string> {
  // Root and its immediate groups start expanded.
  const expanded = new Set<string>([model.root.id]);
  for (const child of model.root.children) {
    if (child.children.length > 0) expanded.add(child.id);
  }
  return expanded;
}

/** The visible rows, in display order (collapsed subtrees skipped). */
function flatten(
  root: ModelNode,
  expanded: Set<string>,
  matches: Set<string> | null,
  hidden: Record<string, true>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (node: ModelNode, depth: number, parentHidden: boolean) => {
    if (matches && !matches.has(node.id)) return;
    const isExpanded = node.children.length > 0 && (matches ? true : expanded.has(node.id));
    rows.push({ node, depth, parentHidden, expanded: isExpanded });
    if (!isExpanded) return;
    const hiddenHere = parentHidden || Boolean(hidden[node.id]);
    for (const child of node.children) walk(child, depth + 1, hiddenHere);
  };
  walk(root, 0, false);
  return rows;
}

/** child id -> parent id, to reveal a node picked in the 3D view. */
function parentMap(root: ModelNode): Map<string, string> {
  const parents = new Map<string, string>();
  const walk = (node: ModelNode) => {
    for (const child of node.children) {
      parents.set(child.id, node.id);
      walk(child);
    }
  };
  walk(root);
  return parents;
}

const rowDomId = (id: string) => `tree-row-${id}`;

const TreeRow = memo(function TreeRow({
  row, top, active, onToggleExpand,
}: {
  row: FlatRow;
  top: number;
  active: boolean;
  onToggleExpand: (id: string) => void;
}) {
  const t = useT();
  const { node, depth, parentHidden, expanded } = row;
  // Per-row selectors: a toggle or selection re-renders just the rows involved.
  const selfHidden = useViewer((s) => Boolean(s.hidden[node.id]));
  const selfTranslucent = useViewer((s) => Boolean(s.translucent[node.id]));
  const isSelected = useViewer((s) => s.selectedId === node.id);
  const setSelected = useViewer((s) => s.setSelected);
  const toggleHidden = useViewer((s) => s.toggleHidden);
  const toggleTranslucent = useViewer((s) => s.toggleTranslucent);

  const effectiveHidden = parentHidden || selfHidden;
  const hasChildren = node.children.length > 0;
  const stop = (action: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    action();
  };

  return (
    <div
      id={rowDomId(node.id)}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      aria-expanded={hasChildren ? expanded : undefined}
      onClick={() => setSelected(isSelected ? null : node.id)}
      style={{ top, height: ROW_HEIGHT, paddingLeft: depth * 14 + 4 }}
      className={`group absolute inset-x-0 flex cursor-default select-none items-center gap-1 rounded-md pr-1 text-[13px] transition-colors
        ${isSelected ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-hover'}
        ${active ? 'ring-2 ring-inset ring-accent/60' : ''}`}
    >
      {hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? t('tree.collapse') : t('tree.expand')}
          onClick={stop(() => onToggleExpand(node.id))}
          className="grid size-4 shrink-0 place-items-center rounded text-ink-faint hover:text-ink"
        >
          <ChevronRightIcon className={`text-[12px] transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
      ) : (
        <span className="grid size-4 shrink-0 place-items-center">
          <span className="size-1.5 rounded-[2px] bg-sky-400/80" />
        </span>
      )}

      <span
        title={node.name}
        className={`flex-1 truncate ${effectiveHidden ? 'text-ink-faint line-through decoration-ink-faint/50' : ''}`}
      >
        {node.name}
      </span>

      {/* Row actions appear on hover — and always on touch screens, which have no hover. */}
      <button
        type="button"
        tabIndex={-1}
        title={t('tree.transparent')}
        aria-label={t('tree.transparent')}
        aria-pressed={selfTranslucent}
        onClick={stop(() => toggleTranslucent(node.id))}
        className={`grid size-5 shrink-0 place-items-center rounded transition-opacity
          ${selfTranslucent
            ? 'text-accent opacity-100'
            : 'text-ink-faint opacity-0 hover:text-ink group-hover:opacity-100 [@media(hover:none)]:opacity-100'}`}
      >
        <TransparencyIcon className="text-[13px]" />
      </button>

      <button
        type="button"
        tabIndex={-1}
        title={selfHidden ? t('tree.show') : t('tree.hide')}
        aria-label={selfHidden ? t('tree.show') : t('tree.hide')}
        onClick={stop(() => toggleHidden(node.id))}
        className={`grid size-5 shrink-0 place-items-center rounded text-ink-faint transition-opacity hover:text-ink
          ${selfHidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100'}`}
      >
        {selfHidden ? <EyeOffIcon className="text-[13px]" /> : <EyeIcon className="text-[13px]" />}
      </button>
    </div>
  );
});

function ModelTree({ model, query }: { model: LoadedModel; query: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(model));
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const hidden = useViewer((s) => s.hidden);
  const selectedId = useViewer((s) => s.selectedId);

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return null;
    const out = new Set<string>();
    collectMatches(model.root, trimmed, out);
    return out;
  }, [model, query]);

  const rows = useMemo(
    () => flatten(model.root, expanded, matches, hidden),
    [model, expanded, matches, hidden],
  );
  const parents = useMemo(() => parentMap(model.root), [model]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scrollToIndex = useCallback((index: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    }
  }, []);

  // A part picked in the 3D view: expand its ancestors and bring it into
  // view — once per selection change, so the user can still collapse it.
  const pendingReveal = useRef<string | null>(null);
  useEffect(() => {
    pendingReveal.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    const target = pendingReveal.current;
    if (!target || matches) return;
    const ancestors: string[] = [];
    for (let id = parents.get(target); id; id = parents.get(id)) ancestors.push(id);
    if (ancestors.some((id) => !expanded.has(id))) {
      setExpanded((previous) => new Set([...previous, ...ancestors]));
      return;
    }
    pendingReveal.current = null;
    const index = rows.findIndex((row) => row.node.id === target);
    if (index >= 0) {
      setActiveIndex(index);
      scrollToIndex(index);
    }
  }, [selectedId, parents, expanded, rows, matches, scrollToIndex]);

  const clampedActive = Math.min(activeIndex, rows.length - 1);

  const onKeyDown = (event: KeyboardEvent) => {
    const row = rows[clampedActive];
    if (!row) return;
    let next = clampedActive;
    switch (event.key) {
      case 'ArrowDown': next = Math.min(rows.length - 1, clampedActive + 1); break;
      case 'ArrowUp': next = Math.max(0, clampedActive - 1); break;
      case 'Home': next = 0; break;
      case 'End': next = rows.length - 1; break;
      case 'PageDown': next = Math.min(rows.length - 1, clampedActive + 10); break;
      case 'PageUp': next = Math.max(0, clampedActive - 10); break;
      case 'ArrowRight':
        if (row.node.children.length > 0 && !row.expanded) toggleExpand(row.node.id);
        else if (row.expanded) next = clampedActive + 1;
        break;
      case 'ArrowLeft':
        if (row.expanded && !matches) toggleExpand(row.node.id);
        else {
          const parentId = parents.get(row.node.id);
          const parentIndex = rows.findIndex((r) => r.node.id === parentId);
          if (parentIndex >= 0) next = parentIndex;
        }
        break;
      case 'Enter':
      case ' ': {
        const { selectedId: current, setSelected } = useViewer.getState();
        setSelected(current === row.node.id ? null : row.node.id);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    setActiveIndex(next);
    scrollToIndex(next);
  };

  if (matches && matches.size === 0) {
    return (
      <p className="px-2 py-4 text-center text-[12px] text-ink-faint">
        {t('tree.noMatch', { q: query.trim() })}
      </p>
    );
  }

  const first = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN);
  const activeRow = rows[clampedActive];

  return (
    <div
      ref={scrollRef}
      role="tree"
      tabIndex={0}
      aria-label={t('tree.label')}
      aria-activedescendant={activeRow ? rowDomId(activeRow.node.id) : undefined}
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        const element = event.currentTarget;
        setViewport({ top: element.scrollTop, height: element.clientHeight });
      }}
      className="h-full overflow-y-auto overflow-x-hidden px-2 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
    >
      <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
        {rows.slice(first, last).map((row, i) => (
          <TreeRow
            key={row.node.id}
            row={row}
            top={(first + i) * ROW_HEIGHT}
            active={first + i === clampedActive}
            onToggleExpand={toggleExpand}
          />
        ))}
      </div>
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const nf = useNumberFormat();
  const model = useViewer((s) => s.model);
  const [query, setQuery] = useState('');

  return (
    // Width tracks the screen on phones (60 vw) and caps at 18 rem on desktop,
    // so the tree never swallows the whole viewport in portrait.
    <aside className="z-30 flex w-[min(18rem,60vw)] shrink-0 flex-col border-r border-line bg-panel max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-xl">
      <div className="p-3 pb-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('tree.search')}
            aria-label={t('tree.search')}
            className="w-full rounded-lg border border-line bg-panel-2 py-1.5 pl-8 pr-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:bg-panel"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {model ? (
          <ModelTree key={model.uid} model={model} query={query} />
        ) : (
          <p className="px-4 py-6 text-center text-[12px] leading-relaxed text-ink-faint">
            {t('tree.empty')}
          </p>
        )}
      </div>

      <footer className="border-t border-line-soft px-3 py-2 text-[11px] text-ink-faint">
        {model ? t('tree.parts', { n: nf.format(model.partCount) }) : t('tree.noModel')}
      </footer>
    </aside>
  );
}
