import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, LogOut, Trash2, Lock, TriangleAlert } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  email: string;
}

export default function AccountMenu({ email }: Props) {
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  async function handleSignOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
          }}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-blue-100/60 transition-colors hover:bg-white/10 hover:text-blue-100"
        >
          <span className="max-w-[160px] truncate">{email}</span>
          <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute right-0 mt-1 w-44 rounded-xl border border-white/10 bg-[#0f1117] py-1 shadow-xl">
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
            <div className="my-1 border-t border-white/10" />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setModalOpen(true);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-400/70 transition-colors hover:bg-white/10 hover:text-red-400"
            >
              <Trash2 className="size-4" />
              Delete account
            </button>
          </div>
        )}
      </div>

      {modalOpen && (
        <DeleteModal
          onClose={() => {
            setModalOpen(false);
          }}
        />
      )}
    </>
  );
}

function DeleteModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        window.location.href = "/";
        return;
      }

      const json = (await res.json()) as { error?: string };
      setError(res.status === 401 ? "Wrong password. Please try again." : (json.error ?? "Something went wrong."));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setPassword("");
    setError(null);
    onClose();
  }

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1117] p-6 shadow-2xl"
      >
        <h2 id="delete-account-title" className="mb-1 text-lg font-semibold text-white">
          Delete account
        </h2>
        <div className="mb-5 flex gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-400" />
          <p className="text-justify text-sm text-red-300">
            This is permanent and cannot be undone. All your photos, identifications, and data will be deleted
            immediately.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            id="delete-password"
            name="password"
            label="Confirm your password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (error) setError(null);
            }}
            placeholder="Your password"
            icon={<Lock className="size-4" />}
            endContent={
              <PasswordToggle
                visible={showPassword}
                onToggle={() => {
                  setShowPassword((v) => !v);
                }}
              />
            }
          />

          <ServerError message={error} />

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !password}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="size-4" />
              {loading ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
