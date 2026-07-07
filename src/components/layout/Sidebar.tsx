import { useMemo, useState } from 'react';
import { useViewer } from '@/store/viewerStore';
import type { LoadedModel, ModelNode } from '@/core/types';
import { useNumberFormat, useT } from '@/i18n';
import {
  ChevronRightIcon, EyeIcon, EyeOffIcon, SearchIcon, TransparencyIcon,
} from '@/components/ui/icons';

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

function TreeNodeRow({
  node, depth, parentHidden, expanded, onToggleExpand, matches,
}: {
  node: ModelNode;
  depth: number;
  parentHidden: boolean;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  matches: Set<string> | null;
}) {
  const t = useT();
  const hidden = useViewer((s) => s.hidden);
  const translucent = useViewer((s) => s.translucent);
  const selectedId = useViewer((s) => s.selectedId);
  const setSelected = useViewer((s) => s.setSelected);
  const toggleHidden = useViewer((s) => s.toggleHidden);
  const toggleTranslucent = useViewer((s) => s.toggleTranslucent);

  if (matches && !matches.has(node.id)) return null;

  const selfHidden = Boolean(hidden[node.id]);
  const selfTranslucent = Boolean(translucent[node.id]);
  const effectiveHidden = parentHidden || selfHidden;
  const hasChildren = node.children.length > 0;
  const isExpanded = matches ? true : expanded.has(node.id);
  const isSelected = selectedId === node.id;

  return (
    <>
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        onClick={() => setSelected(isSelected ? null : node.id)}
        style={{ paddingLeft: depth * 14 + 4 }}
        className={`group flex cursor-default select-none items-center gap-1 rounded-md py-[3px] pr-1 text-[13px] transition-colors
          ${isSelected ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-hover'}`}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={isExpanded ? t('tree.collapse') : t('tree.expand')}
            onClick={(event) => { event.stopPropagation(); onToggleExpand(node.id); }}
            className="grid size-4 shrink-0 place-items-center rounded text-ink-faint hover:text-ink"
          >
            <ChevronRightIcon className={`text-[12px] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
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

        <button
          type="button"
          title={t('tree.transparent')}
          onClick={(event) => { event.stopPropagation(); toggleTranslucent(node.id); }}
          className={`grid size-5 shrink-0 place-items-center rounded transition-opacity
            ${selfTranslucent
              ? 'text-accent opacity-100'
              : 'text-ink-faint opacity-0 hover:text-ink group-hover:opacity-100'}`}
        >
          <TransparencyIcon className="text-[13px]" />
        </button>

        <button
          type="button"
          title={selfHidden ? t('tree.show') : t('tree.hide')}
          onClick={(event) => { event.stopPropagation(); toggleHidden(node.id); }}
          className={`grid size-5 shrink-0 place-items-center rounded text-ink-faint transition-opacity hover:text-ink
            ${selfHidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          {selfHidden ? <EyeOffIcon className="text-[13px]" /> : <EyeIcon className="text-[13px]" />}
        </button>
      </div>

      {hasChildren && isExpanded &&
        node.children.map((child) => (
          <TreeNodeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            parentHidden={effectiveHidden}
            expanded={expanded}
            onToggleExpand={onToggleExpand}
            matches={matches}
          />
        ))}
    </>
  );
}

function ModelTree({ model, query }: { model: LoadedModel; query: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(model));

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return null;
    const out = new Set<string>();
    collectMatches(model.root, trimmed, out);
    return out;
  }, [model, query]);

  const toggleExpand = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (matches && matches.size === 0) {
    return (
      <p className="px-2 py-4 text-center text-[12px] text-ink-faint">
        {t('tree.noMatch', { q: query.trim() })}
      </p>
    );
  }

  return (
    <div role="tree">
      <TreeNodeRow
        node={model.root}
        depth={0}
        parentHidden={false}
        expanded={expanded}
        onToggleExpand={toggleExpand}
        matches={matches}
      />
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const nf = useNumberFormat();
  const model = useViewer((s) => s.model);
  const [query, setQuery] = useState('');

  return (
    <aside className="z-10 flex w-72 shrink-0 flex-col border-r border-line bg-panel max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-xl">
      <div className="p-3 pb-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('tree.search')}
            className="w-full rounded-lg border border-line bg-panel-2 py-1.5 pl-8 pr-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:bg-panel"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
        {model ? (
          <ModelTree key={model.name} model={model} query={query} />
        ) : (
          <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-ink-faint">
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
