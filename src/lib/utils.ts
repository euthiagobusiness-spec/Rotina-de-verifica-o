import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function whatsappUrl(phone: string, message?: string) {
  const cleanPhone = digitsOnly(phone);
  const encoded = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${cleanPhone}${encoded}`;
}

export function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "https://localhost:5004";
}

export function portalUrl(token: string) {
  return `${getBaseUrl()}/portal/${token}`;
}

export function publicUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${getBaseUrl()}${normalized}`;
}

export function createPortalToken() {
  return crypto.randomUUID().replaceAll("-", "");
}

export function parseLines(value: string | null | undefined) {
  return (value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toTextareaValue(value: string[] | null | undefined) {
  return (value ?? []).join("\n");
}

export function toJsonText(value: unknown) {
  return JSON.stringify(value ?? [], null, 2);
}

export function parseJsonArray<T>(value: string, fallback: T[] = []) {
  if (!value.trim()) return fallback;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}
