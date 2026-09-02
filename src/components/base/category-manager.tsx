import { useReducer } from "react";
import { X, Plus, Check, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCategoriesStore } from "@/features/categories/use-categories-store";
import type { Category } from "@/lib/db/types";
import { CATEGORY_PRESET_COLORS } from "@/lib/category-colors";
import { cn } from "@/lib/cn";

interface CategoryManagerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (category: Category) => void;
}

interface UIState {
  editingId: number | null;
  editName: string;
  editColor: string;
  isAddingNew: boolean;
  newName: string;
  newColor: string;
  deleteConfirmId: number | null;
}

type UIAction =
  | { type: "START_EDIT"; id: number; name: string; color: string }
  | { type: "SET_EDIT_NAME"; name: string }
  | { type: "SET_EDIT_COLOR"; color: string }
  | { type: "END_EDIT" }
  | { type: "START_ADD" }
  | { type: "SET_NEW_NAME"; name: string }
  | { type: "SET_NEW_COLOR"; color: string }
  | { type: "CANCEL_ADD" }
  | { type: "FINISH_ADD" }
  | { type: "CONFIRM_DELETE"; id: number }
  | { type: "CANCEL_DELETE" };

const INITIAL_UI: UIState = {
  editingId: null,
  editName: "",
  editColor: CATEGORY_PRESET_COLORS[0],
  isAddingNew: false,
  newName: "",
  newColor: CATEGORY_PRESET_COLORS[0],
  deleteConfirmId: null,
};

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "START_EDIT":
      return {
        ...state,
        editingId: action.id,
        editName: action.name,
        editColor: action.color,
      };
    case "SET_EDIT_NAME":
      return { ...state, editName: action.name };
    case "SET_EDIT_COLOR":
      return { ...state, editColor: action.color };
    case "END_EDIT":
      return { ...state, editingId: null, editName: "", editColor: CATEGORY_PRESET_COLORS[0] };
    case "START_ADD":
      return { ...state, isAddingNew: true };
    case "SET_NEW_NAME":
      return { ...state, newName: action.name };
    case "SET_NEW_COLOR":
      return { ...state, newColor: action.color };
    case "CANCEL_ADD":
      return { ...state, isAddingNew: false, newName: "" };
    case "FINISH_ADD":
      return { ...INITIAL_UI };
    case "CONFIRM_DELETE":
      return { ...state, deleteConfirmId: action.id };
    case "CANCEL_DELETE":
      return { ...state, deleteConfirmId: null };
  }
}

function TagColorPalette({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Tag color">
      {CATEGORY_PRESET_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Use tag color ${color}`}
          onClick={() => onChange(color)}
          className={cn(
            "size-7 rounded-full border-2 transition-transform hover:scale-110",
            value === color ? "border-sahara-text scale-110" : "border-white/80",
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

export function CategoryManager({
  open,
  onClose,
  onSelect,
}: CategoryManagerProps) {
  const categories = useCategoriesStore((s) => s.categories);
  const addCategory = useCategoriesStore((s) => s.addCategory);
  const updateCategory = useCategoriesStore((s) => s.updateCategory);
  const deleteCategory = useCategoriesStore((s) => s.deleteCategory);

  const [ui, dispatch] = useReducer(uiReducer, INITIAL_UI);

  const handleDelete = async (id: number) => {
    await deleteCategory(id);
    dispatch({ type: "CANCEL_DELETE" });
  };

  if (!open) return null;

  const handleSaveEdit = async (id: number) => {
    if (!ui.editName.trim()) return;
    await updateCategory(id, ui.editName.trim(), ui.editColor);
    dispatch({ type: "END_EDIT" });
  };

  const handleAddNew = async () => {
    if (!ui.newName.trim()) return;
    const category = await addCategory(ui.newName.trim(), ui.newColor);
    onSelect(category);
    dispatch({ type: "FINISH_ADD" });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 200 }}
    >
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        role="button"
        tabIndex={-1}
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClose(); } }}
      />
      <div className="relative w-full max-w-lg bg-sahara-surface rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-sahara-border/20">
          <h2 className="font-serif text-xl text-sahara-text">
            {ui.isAddingNew
              ? "New Tag"
              : ui.editingId
                ? "Edit Tag"
                : "Tags"}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            intent="default"
            shape="rounded-full"
            onClick={onClose}
            className="text-sahara-text-muted hover:text-sahara-text"
          >
            <X className="size-5" />
          </Button>
        </div>

        {ui.isAddingNew ? (
          /* Add New Form */
          <div className="px-6 py-5 space-y-4">
            <input
              type="text"
              placeholder="Tag name, e.g. Study or Research..."
              value={ui.newName}
              onChange={(e) => dispatch({ type: "SET_NEW_NAME", name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleAddNew()}
              className="w-full px-4 py-3 rounded-xl border border-sahara-border/30 bg-sahara-bg/50 text-sm font-medium focus:outline-none focus:border-sahara-primary/50"
            />
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-sahara-text-muted">
                Tag color
              </p>
              <TagColorPalette
                value={ui.newColor}
                onChange={(color) => dispatch({ type: "SET_NEW_COLOR", color })}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                size="md"
                fullWidth
                onClick={() => dispatch({ type: "CANCEL_ADD" })}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                intent="green"
                size="md"
                fullWidth
                onClick={handleAddNew}
                disabled={!ui.newName.trim()}
                className="gap-2"
              >
                <Plus className="size-4" /> Create Tag
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Categories List */}
            <div className="px-6 py-4 max-h-72 overflow-y-auto">
              {categories.length === 0 && (
                <p className="text-center text-sm text-sahara-text-muted py-6">
                  No tags yet
                </p>
              )}
              {categories.map((category) => (
                <div key={category.id}>
                  {ui.editingId === category.id ? (
                    /* Edit Inline Form */
                    <div className="space-y-3 px-4 py-3 rounded-xl bg-sahara-bg/50 mb-2">
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          value={ui.editName}
                          onChange={(e) => dispatch({ type: "SET_EDIT_NAME", name: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(category.id)}
                          className="flex-1 px-3 py-2 rounded-lg border border-sahara-border/30 text-sm font-medium focus:outline-none focus:border-sahara-primary"
                        />
                        <Button
                          variant="solid"
                          intent="green"
                          size="icon-sm"
                          shape="rounded-lg"
                          onClick={() => handleSaveEdit(category.id)}
                        >
                          <Check className="size-3.5" />
                        </Button>
                      </div>
                      <TagColorPalette
                        value={ui.editColor}
                        onChange={(color) => dispatch({ type: "SET_EDIT_COLOR", color })}
                      />
                    </div>
                  ) : (
                    /* Display Row */
                    <div className="group flex items-center justify-between px-4 py-3 rounded-xl mb-1 hover:bg-sahara-card transition-colors">
                      <div className="flex items-center gap-3">
                        <div
                          className="size-3 rounded-full shrink-0"
                          style={{ backgroundColor: category.color }}
                        />
                        <span className="text-base font-medium text-sahara-text">
                          {category.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {ui.deleteConfirmId === category.id ? (
                          <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 px-2 py-1 rounded-lg">
                            <span className="text-sm font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">
                              Delete?
                            </span>
                            <button
                              onClick={() => handleDelete(category.id)}
                              className="text-sm cursor-pointer font-bold text-white px-1.5 py-0.5 rounded bg-red-600 hover:bg-red-700 transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => dispatch({ type: "CANCEL_DELETE" })}
                              className="text-sm cursor-pointer font-medium text-sahara-text-muted hover:text-sahara-text px-1.5 py-0.5 rounded hover:bg-sahara-border/20 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                dispatch({
                                  type: "START_EDIT",
                                  id: category.id,
                                  name: category.name,
                                  color: category.color,
                                });
                              }}
                              className="opacity-0 group-hover:opacity-100 text-sahara-text-muted hover:text-sahara-text-secondary"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => dispatch({ type: "CONFIRM_DELETE", id: category.id })}
                              className="opacity-0 group-hover:opacity-100 text-sahara-text-muted hover:text-red-500"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 pb-6">
              <Button
                variant="solid"
                intent="green"
                fullWidth
                onClick={() => dispatch({ type: "START_ADD" })}
                className="gap-2 bg-green-500/90 hover:bg-green-500"
              >
                <Plus className="size-4" />
                ADD NEW TAG
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
