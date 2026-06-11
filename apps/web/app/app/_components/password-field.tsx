"use client";

import { useState, type KeyboardEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { userFieldClassName } from "./form-ui";

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  autoFocus?: boolean | undefined;
  autoComplete?: string | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined;
  className?: string | undefined;
  showLabel: string;
  hideLabel: string;
}

export function PasswordField({
  value,
  onChange,
  placeholder,
  autoFocus,
  autoComplete,
  onKeyDown,
  className,
  showLabel,
  hideLabel
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const label = visible ? hideLabel : showLabel;

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        className={cn(userFieldClassName(), className, "pr-11")}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={label}
        title={label}
        className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-xl text-text-subtle transition-colors hover:text-text"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
