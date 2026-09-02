import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Copy, GripVertical, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Button } from "@/components/ui/button";
import { formatMinutesAsDuration } from "@/lib/session-utils";
import { CategoryManager } from "@/components/base/category-manager";
import { useCategoriesStore } from "@/features/categories/use-categories-store";
import { UNTAGGED_BLOCK_COLOR } from "@/lib/constants";
import {
  addQuickBlock,
  addSequenceTemplate,
  appendQuickBlockToSequence,
  clearSequenceTemplateItems,
  deleteQuickBlock,
  deleteSequenceTemplate,
  deleteSequenceTemplateItem,
  duplicateSequenceTemplate,
  getQuickBlocks,
  getSequenceTemplateItems,
  getSequenceTemplates,
  reorderSequenceTemplateItems,
  updateQuickBlock,
  updateSequenceTemplate,
  type QuickBlock,
  type SequenceTemplate,
  type SequenceTemplateItem,
} from "@/lib/db";

interface SequenceTemplateManagerProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_COLOR = "#c2652a";

/** Edit reusable block sequences only. Dates and absolute start times belong
 * to the calendar insertion flow and are deliberately excluded here. */
export function SequenceTemplateManager({ open, onClose }: SequenceTemplateManagerProps) {
  const [templates, setTemplates] = useState<SequenceTemplate[]>([]);
  const [quickBlocks, setQuickBlocks] = useState<QuickBlock[]>([]);
  const [items, setItems] = useState<SequenceTemplateItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateColor, setTemplateColor] = useState(DEFAULT_COLOR);
  const [blockEditorOpen, setBlockEditorOpen] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [blockName, setBlockName] = useState("");
  const [blockDuration, setBlockDuration] = useState(30);
  const [blockCategoryId, setBlockCategoryId] = useState<string>("");
  const [blockNotification, setBlockNotification] = useState(true);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const categories = useCategoriesStore((state) => state.categories);
  const loadCategories = useCategoriesStore((state) => state.loadCategories);

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const loadTemplates = useCallback(async (preferredId?: number) => {
    const rows = await getSequenceTemplates();
    setTemplates(rows);
    setSelectedId((current) => preferredId ?? current ?? rows[0]?.id ?? null);
  }, []);

  const loadQuickBlocks = useCallback(async () => {
    setQuickBlocks(await getQuickBlocks());
  }, []);

  const loadItems = useCallback(async (templateId: number | null) => {
    setItems(templateId ? await getSequenceTemplateItems(templateId) : []);
  }, []);

  useEffect(() => {
    if (!open) return;
    Promise.all([loadTemplates(), loadQuickBlocks(), loadCategories()]).catch((error) => setMessage(String(error)));
  }, [open, loadTemplates, loadQuickBlocks, loadCategories]);

  useEffect(() => {
    if (!selected) {
      setTemplateName("");
      setItems([]);
      return;
    }
    setTemplateName(selected.name);
    setTemplateColor(selected.color);
    loadItems(selected.id).catch((error) => setMessage(String(error)));
  }, [selected, loadItems]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage(String((error as Error)?.message ?? error));
    } finally {
      setBusy(false);
    }
  };

  const openNewBlock = () => {
    setEditingBlockId(null);
    setBlockName("");
    setBlockDuration(30);
    setBlockCategoryId("");
    setBlockNotification(true);
    setBlockEditorOpen(true);
  };

  const openBlockEditor = (block: QuickBlock) => {
    setEditingBlockId(block.id);
    setBlockName(block.name);
    setBlockDuration(block.duration_minutes);
    setBlockCategoryId(block.category_id ? String(block.category_id) : "");
    setBlockNotification(Boolean(block.notification_enabled));
    setBlockEditorOpen(true);
  };

  const appendBlock = (blockId: number) => {
    if (!selectedId) return;
    void run(async () => {
      await appendQuickBlockToSequence(selectedId, blockId);
      await Promise.all([loadItems(selectedId), loadTemplates(selectedId)]);
    });
  };

  const moveItem = (sourceId: number, targetId: number) => {
    if (!selectedId || sourceId === targetId) return;
    const next = [...items];
    const sourceIndex = next.findIndex((item) => item.id === sourceId);
    const targetIndex = next.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    setItems(next);
    void run(async () => {
      await reorderSequenceTemplateItems(selectedId, next.map((item) => item.id));
      await loadItems(selectedId);
    });
  };

  return (
    <>
    <ModalOverlay open={open} onClose={onClose} maxWidth="max-w-4xl" showCloseButton>
      <div className="max-h-[82vh] overflow-y-auto p-5 md:p-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sahara-text-muted">Reusable sequences</p>
            <h2 className="font-serif text-2xl text-sahara-text">Templates</h2>
          </div>
          <Button variant="outline" intent="sahara" size="sm" disabled={busy} onClick={() => void run(async () => {
            const id = await addSequenceTemplate({ name: "New Template", color: DEFAULT_COLOR });
            await loadTemplates(id);
          })}>
            <Plus className="mr-1.5 size-3.5" /> New template
          </Button>
        </header>

        <div className="mb-5 flex flex-wrap gap-2">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => setSelectedId(template.id)}
              className={`rounded-full border px-3 py-2 text-left text-xs transition-colors ${selectedId === template.id ? "border-sahara-primary bg-sahara-primary-light text-sahara-primary" : "border-sahara-border/30 bg-sahara-bg/35 text-sahara-text-secondary hover:border-sahara-primary/40"}`}
            >
              <span className="mr-2 inline-block size-2 rounded-full" style={{ backgroundColor: template.color }} />
              <span className="font-semibold">{template.name}</span>
              <span className="ml-2 text-[10px] text-sahara-text-muted">{template.item_count ?? 0} blocks · {formatMinutesAsDuration(template.total_minutes ?? 0)}</span>
            </button>
          ))}
        </div>

        {!selected ? (
          <div className="rounded-2xl border border-dashed border-sahara-border/40 p-8 text-center text-sm text-sahara-text-muted">Create a template to begin.</div>
        ) : (
          <div className="space-y-5">
            <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-sahara-border/25 bg-sahara-bg/25 p-3">
              <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} aria-label="Template name" className="min-w-[180px] flex-1 rounded-xl border border-sahara-border/30 bg-sahara-surface px-3 py-2 text-sm text-sahara-text" />
              <input type="color" value={templateColor} onChange={(event) => setTemplateColor(event.target.value)} aria-label="Template color" className="h-9 w-12 rounded-lg border border-sahara-border/30 bg-sahara-surface p-1" />
              <Button variant="solid" intent="sahara" size="xs" disabled={busy} onClick={() => void run(async () => {
                await updateSequenceTemplate(selected.id, { name: templateName, color: templateColor });
                await loadTemplates(selected.id);
                setMessage("Template saved.");
              })}><Save className="mr-1.5 size-3" /> Save</Button>
              <Button variant="ghost" intent="default" size="xs" disabled={busy} onClick={() => void run(async () => {
                const id = await duplicateSequenceTemplate(selected.id);
                await loadTemplates(id);
              })}><Copy className="mr-1.5 size-3" /> Duplicate</Button>
              <Button variant="ghost" intent="red" size="xs" disabled={busy} onClick={() => {
                if (!window.confirm(`Delete “${selected.name}”?`)) return;
                void run(async () => {
                  await deleteSequenceTemplate(selected.id);
                  setSelectedId(null);
                  await loadTemplates();
                });
              }}><Trash2 className="size-3.5" /></Button>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-sahara-text-muted">Quick blocks</h3>
                  <p className="mt-0.5 text-xs text-sahara-text-muted">Click a block to append it to this template.</p>
                </div>
                <Button variant="outline" intent="sahara" size="xs" onClick={openNewBlock}><Plus className="mr-1 size-3" /> Custom block</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {quickBlocks.map((block) => (
                  <div key={block.id} className="group relative">
                    <button
                      disabled={busy}
                      onClick={() => appendBlock(block.id)}
                      className="min-w-[92px] rounded-xl px-4 py-3 text-left text-white shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                      style={{ backgroundColor: block.category_color || UNTAGGED_BLOCK_COLOR }}
                    >
                      <span className="block text-sm font-bold">{formatMinutesAsDuration(block.duration_minutes)}</span>
                      <span className="block max-w-[110px] truncate text-[10px] opacity-90">{block.name}</span>
                      <span className="block max-w-[110px] truncate text-[9px] opacity-75">{block.category_name || "No tag"}</span>
                    </button>
                    <button onClick={() => openBlockEditor(block)} aria-label={`Edit ${block.name}`} className="absolute right-1.5 top-1.5 rounded-md bg-black/15 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"><Pencil className="size-3" /></button>
                  </div>
                ))}
              </div>

              {blockEditorOpen && (
                <div className="mt-3 grid gap-2 rounded-2xl border border-sahara-border/25 bg-sahara-bg/30 p-3 sm:grid-cols-[1fr_110px_minmax(145px,0.8fr)_auto_auto] sm:items-center">
                  <input value={blockName} onChange={(event) => setBlockName(event.target.value)} placeholder="Block name" className="rounded-xl border border-sahara-border/30 bg-sahara-surface px-3 py-2 text-sm text-sahara-text" />
                  <label className="flex items-center gap-2 rounded-xl border border-sahara-border/30 bg-sahara-surface px-3 py-2 text-xs text-sahara-text-muted">
                    <input type="number" min={1} max={1440} value={blockDuration} onChange={(event) => setBlockDuration(Number(event.target.value))} className="w-14 bg-transparent text-sm text-sahara-text outline-none" /> min
                  </label>
                  <select
                    value={blockCategoryId}
                    onChange={(event) => setBlockCategoryId(event.target.value)}
                    aria-label="Block tag"
                    className="h-9 rounded-xl border border-sahara-border/30 bg-sahara-surface px-3 text-xs text-sahara-text"
                  >
                    <option value="">No tag (gray)</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                  <button onClick={() => setBlockNotification((value) => !value)} className="flex items-center justify-center gap-1 rounded-xl border border-sahara-border/30 px-3 py-2 text-xs text-sahara-text-muted" title="Toggle reminder">
                    {blockNotification ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
                  </button>
                  <div className="flex gap-1">
                    <Button variant="solid" intent="sahara" size="xs" disabled={busy} onClick={() => void run(async () => {
                      const input = {
                        name: blockName,
                        duration_minutes: blockDuration,
                        category_id: blockCategoryId ? Number(blockCategoryId) : null,
                        notification_enabled: blockNotification,
                      };
                      if (editingBlockId) await updateQuickBlock(editingBlockId, input);
                      else await addQuickBlock(input);
                      await Promise.all([loadQuickBlocks(), selectedId ? loadItems(selectedId) : Promise.resolve()]);
                      setBlockEditorOpen(false);
                    })}>Save</Button>
                    <Button variant="ghost" intent="default" size="xs" onClick={() => setTagManagerOpen(true)}>Tags</Button>
                    {editingBlockId && <Button variant="ghost" intent="red" size="xs" disabled={busy} onClick={() => {
                      if (!window.confirm(`Delete “${blockName}” from the quick-block palette?`)) return;
                      void run(async () => {
                        await deleteQuickBlock(editingBlockId);
                        await loadQuickBlocks();
                        setBlockEditorOpen(false);
                      });
                    }}><Trash2 className="size-3" /></Button>}
                    <Button variant="ghost" intent="default" size="xs" onClick={() => setBlockEditorOpen(false)}><X className="size-3" /></Button>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-sahara-border/25 bg-sahara-bg/25 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-sahara-text-muted">Template sequence</h3>
                  <p className="mt-0.5 text-xs text-sahara-text-muted">Drag blocks to reorder them.</p>
                </div>
                {items.length > 0 && <Button variant="ghost" intent="red" size="xs" disabled={busy} onClick={() => {
                  if (!window.confirm("Clear this template sequence?")) return;
                  void run(async () => {
                    await clearSequenceTemplateItems(selected.id);
                    await Promise.all([loadItems(selected.id), loadTemplates(selected.id)]);
                  });
                }}>Clear</Button>}
              </div>
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-sahara-border/40 px-4 py-7 text-center text-xs text-sahara-text-muted">Click a quick block above to build this template.</div>
              ) : (
                <div className="flex min-h-20 flex-wrap items-center gap-2">
                  {items.map((item, index) => (
                    <div key={item.id} className="flex items-center gap-2">
                      {index > 0 && <span className="text-sahara-text-muted">→</span>}
                      <div
                        draggable
                        onDragStart={() => setDraggedItemId(item.id)}
                        onDragEnd={() => setDraggedItemId(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (draggedItemId) moveItem(draggedItemId, item.id);
                          setDraggedItemId(null);
                        }}
                        className={`group flex cursor-grab items-center gap-2 rounded-xl px-3 py-2 text-white shadow-sm active:cursor-grabbing ${draggedItemId === item.id ? "opacity-50" : ""}`}
                        style={{ backgroundColor: item.category_color || UNTAGGED_BLOCK_COLOR }}
                      >
                        <GripVertical className="size-3.5 opacity-65" />
                        <span>
                          <span className="block text-xs font-bold">{formatMinutesAsDuration(item.duration_minutes)}</span>
                          <span className="block max-w-24 truncate text-[9px] opacity-85">{item.title}</span>
                          <span className="block max-w-24 truncate text-[8px] opacity-70">{item.category_name || "No tag"}</span>
                        </span>
                        <button aria-label={`Remove ${item.title}`} onClick={() => void run(async () => {
                          await deleteSequenceTemplateItem(item.id);
                          await Promise.all([loadItems(selected.id), loadTemplates(selected.id)]);
                        })} className="ml-1 rounded-md p-0.5 opacity-65 hover:bg-black/15 hover:opacity-100"><X className="size-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 text-right text-[10px] font-bold uppercase tracking-widest text-sahara-text-muted">{items.length} blocks · {formatMinutesAsDuration(items.reduce((sum, item) => sum + item.duration_minutes, 0))}</div>
            </section>
          </div>
        )}

        {message && <p className="mt-4 rounded-xl bg-sahara-primary-light px-3 py-2 text-xs text-sahara-primary">{message}</p>}
      </div>
    </ModalOverlay>
    <CategoryManager
      open={tagManagerOpen}
      onClose={() => {
        setTagManagerOpen(false);
        void Promise.all([loadQuickBlocks(), selectedId ? loadItems(selectedId) : Promise.resolve()]);
      }}
      onSelect={(category) => setBlockCategoryId(String(category.id))}
    />
    </>
  );
}
