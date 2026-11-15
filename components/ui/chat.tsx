"use client";

import {
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "./button";
import { cn } from "./cn";
import { Textarea } from "./input";

export type ChatBubbleProps = ComponentProps<"div"> & {
  role?: "user" | "assistant";
};

/** One chat message. The founder's sit on the right in white; the consultant's on glass. */
export function ChatBubble({
  role: author = "assistant",
  className,
  ...props
}: ChatBubbleProps) {
  return (
    <div
      {...props}
      data-role={author}
      className={cn(
        "max-w-[85%] whitespace-pre-wrap break-words rounded-panel px-4 py-2.5 text-sm",
        author === "user"
          ? "ml-auto bg-accent text-on-accent"
          : "mr-auto border border-glass-edge bg-panel-raised text-ink",
        className,
      )}
    />
  );
}

export type ComposerProps = {
  onSubmit: (text: string) => void;
  "aria-label"?: string;
  placeholder?: string;
  submitLabel?: string;
  /** Sending in progress: the field keeps its text and the button shows a spinner. */
  loading?: boolean;
  disabled?: boolean;
  className?: string;
};

/** Message box: Enter sends, Shift+Enter adds a line. */
export function Composer({
  onSubmit,
  "aria-label": label = "Message",
  placeholder,
  submitLabel = "Send",
  loading = false,
  disabled = false,
  className,
}: ComposerProps) {
  const [text, setText] = useState("");
  const blocked = disabled || loading;
  const empty = text.trim() === "";

  function send() {
    if (blocked || empty) return;
    onSubmit(text.trim());
    setText("");
  }

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        send();
      }}
      className={cn("flex items-end gap-2", className)}
    >
      <Textarea
        aria-label={label}
        placeholder={placeholder}
        value={text}
        rows={1}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            send();
          }
        }}
        className="min-h-10 flex-1 resize-none"
      />
      <Button type="submit" loading={loading} disabled={disabled || empty}>
        {submitLabel}
      </Button>
    </form>
  );
}
