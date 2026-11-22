// WPF-kompatible Modifier-Flags und KeyCode-Konvertierung für Taster-/Schalter-Tastaturtrigger
export const MODIFIER_NONE = 0;
export const MODIFIER_ALT = 1;
export const MODIFIER_CONTROL = 2;
export const MODIFIER_SHIFT = 4;
export const MODIFIER_META = 8;

const WPF_KEY_BACK = 2;
const WPF_KEY_TAB = 3;
const WPF_KEY_RETURN = 6;
const WPF_KEY_ESCAPE = 13;
const WPF_KEY_SPACE = 18;
const WPF_KEY_PAGE_UP = 19;
const WPF_KEY_PAGE_DOWN = 20;
const WPF_KEY_END = 21;
const WPF_KEY_HOME = 22;
const WPF_KEY_LEFT = 23;
const WPF_KEY_UP = 24;
const WPF_KEY_RIGHT = 25;
const WPF_KEY_DOWN = 26;
const WPF_KEY_INSERT = 30;
const WPF_KEY_DELETE = 32;
const WPF_KEY_D0 = 34;
const WPF_KEY_A = 44;
const WPF_KEY_NUMPAD0 = 74;
const WPF_KEY_MULTIPLY = 84;
const WPF_KEY_ADD = 85;
const WPF_KEY_SUBTRACT = 87;
const WPF_KEY_DECIMAL = 88;
const WPF_KEY_DIVIDE = 89;
const WPF_KEY_F1 = 90;
const WPF_KEY_OEM_SEMICOLON = 140;
const WPF_KEY_OEM_PLUS = 141;
const WPF_KEY_OEM_COMMA = 142;
const WPF_KEY_OEM_MINUS = 143;
const WPF_KEY_OEM_PERIOD = 144;
const WPF_KEY_OEM_QUESTION = 145;
const WPF_KEY_OEM_TILDE = 146;
const WPF_KEY_OEM_OPEN_BRACKETS = 149;
const WPF_KEY_OEM_PIPE = 150;
const WPF_KEY_OEM_CLOSE_BRACKETS = 151;
const WPF_KEY_OEM_QUOTES = 152;
const SYNTHETIC_CHAR_OFFSET = 1000;

export type KeyboardGestureEventLike = {
  key: string;
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

const MODIFIER_ONLY_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "AltGraph",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "OS",
]);

const SPECIAL_CODE_MAP: Record<string, number> = {
  Backspace: WPF_KEY_BACK,
  Tab: WPF_KEY_TAB,
  Enter: WPF_KEY_RETURN,
  NumpadEnter: WPF_KEY_RETURN,
  Escape: WPF_KEY_ESCAPE,
  Space: WPF_KEY_SPACE,
  PageUp: WPF_KEY_PAGE_UP,
  PageDown: WPF_KEY_PAGE_DOWN,
  End: WPF_KEY_END,
  Home: WPF_KEY_HOME,
  ArrowLeft: WPF_KEY_LEFT,
  ArrowUp: WPF_KEY_UP,
  ArrowRight: WPF_KEY_RIGHT,
  ArrowDown: WPF_KEY_DOWN,
  Insert: WPF_KEY_INSERT,
  Delete: WPF_KEY_DELETE,
  NumpadMultiply: WPF_KEY_MULTIPLY,
  NumpadAdd: WPF_KEY_ADD,
  NumpadSubtract: WPF_KEY_SUBTRACT,
  NumpadDecimal: WPF_KEY_DECIMAL,
  NumpadDivide: WPF_KEY_DIVIDE,
};

const SPECIAL_KEY_MAP: Record<string, number> = {
  Backspace: WPF_KEY_BACK,
  Tab: WPF_KEY_TAB,
  Enter: WPF_KEY_RETURN,
  Escape: WPF_KEY_ESCAPE,
  " ": WPF_KEY_SPACE,
  Spacebar: WPF_KEY_SPACE,
  PageUp: WPF_KEY_PAGE_UP,
  PageDown: WPF_KEY_PAGE_DOWN,
  End: WPF_KEY_END,
  Home: WPF_KEY_HOME,
  ArrowLeft: WPF_KEY_LEFT,
  ArrowUp: WPF_KEY_UP,
  ArrowRight: WPF_KEY_RIGHT,
  ArrowDown: WPF_KEY_DOWN,
  Insert: WPF_KEY_INSERT,
  Delete: WPF_KEY_DELETE,
};

const OEM_CODE_MAP: Record<string, number> = {
  Semicolon: WPF_KEY_OEM_SEMICOLON,
  Equal: WPF_KEY_OEM_PLUS,
  Comma: WPF_KEY_OEM_COMMA,
  Minus: WPF_KEY_OEM_MINUS,
  Period: WPF_KEY_OEM_PERIOD,
  Slash: WPF_KEY_OEM_QUESTION,
  Backquote: WPF_KEY_OEM_TILDE,
  BracketLeft: WPF_KEY_OEM_OPEN_BRACKETS,
  Backslash: WPF_KEY_OEM_PIPE,
  BracketRight: WPF_KEY_OEM_CLOSE_BRACKETS,
  Quote: WPF_KEY_OEM_QUOTES,
};

const KEY_LABELS: Record<number, string> = {
  [WPF_KEY_BACK]: "Backspace",
  [WPF_KEY_TAB]: "Tab",
  [WPF_KEY_RETURN]: "Enter",
  [WPF_KEY_ESCAPE]: "Esc",
  [WPF_KEY_SPACE]: "Leertaste",
  [WPF_KEY_PAGE_UP]: "Bild↑",
  [WPF_KEY_PAGE_DOWN]: "Bild↓",
  [WPF_KEY_END]: "Ende",
  [WPF_KEY_HOME]: "Pos1",
  [WPF_KEY_LEFT]: "←",
  [WPF_KEY_UP]: "↑",
  [WPF_KEY_RIGHT]: "→",
  [WPF_KEY_DOWN]: "↓",
  [WPF_KEY_INSERT]: "Einfg",
  [WPF_KEY_DELETE]: "Entf",
  [WPF_KEY_MULTIPLY]: "Num *",
  [WPF_KEY_ADD]: "Num +",
  [WPF_KEY_SUBTRACT]: "Num -",
  [WPF_KEY_DECIMAL]: "Num ,",
  [WPF_KEY_DIVIDE]: "Num /",
  [WPF_KEY_OEM_SEMICOLON]: ";",
  [WPF_KEY_OEM_PLUS]: "=",
  [WPF_KEY_OEM_COMMA]: ",",
  [WPF_KEY_OEM_MINUS]: "-",
  [WPF_KEY_OEM_PERIOD]: ".",
  [WPF_KEY_OEM_QUESTION]: "/",
  [WPF_KEY_OEM_TILDE]: "`",
  [WPF_KEY_OEM_OPEN_BRACKETS]: "[",
  [WPF_KEY_OEM_PIPE]: "\\",
  [WPF_KEY_OEM_CLOSE_BRACKETS]: "]",
  [WPF_KEY_OEM_QUOTES]: "'",
};

// Prüft, ob es sich um eine reine Zusatztaste ohne Haupttaste handelt
export function isModifierOnlyKey(key: string): boolean {
  return MODIFIER_ONLY_KEYS.has(key);
}

// Berechnet das WPF-kompatible Modifier-Bitfeld aus einem KeyboardEvent
export function getKeyboardEventModifiers(event: {
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): number {
  let modifiers = MODIFIER_NONE;
  if (event.altKey) {
    modifiers |= MODIFIER_ALT;
  }
  if (event.ctrlKey) {
    modifiers |= MODIFIER_CONTROL;
  }
  if (event.shiftKey) {
    modifiers |= MODIFIER_SHIFT;
  }
  if (event.metaKey) {
    modifiers |= MODIFIER_META;
  }
  return modifiers;
}

// Konvertiert ein Browser-KeyboardEvent in einen WPF-kompatiblen KeyCode
export function keyboardEventToWpfKeyCode(event: {
  key: string;
  code?: string;
}): number {
  const code = event.code ?? "";
  const key = event.key ?? "";

  if (code && code in SPECIAL_CODE_MAP) {
    return SPECIAL_CODE_MAP[code];
  }

  if (code.startsWith("Numpad") && code.length === 7) {
    const digit = Number(code.slice(6));
    if (Number.isInteger(digit) && digit >= 0 && digit <= 9) {
      return WPF_KEY_NUMPAD0 + digit;
    }
  }

  const fnCodeMatch = /^(F)([1-9]|1[0-2])$/.exec(code || key);
  if (fnCodeMatch) {
    return WPF_KEY_F1 + (Number(fnCodeMatch[2]) - 1);
  }

  if (key in SPECIAL_KEY_MAP) {
    return SPECIAL_KEY_MAP[key];
  }

  // Bei Buchstaben/Ziffern hat event.key Vorrang (z. B. für deutsches QWERTZ-Layout)
  if (key.length === 1) {
    const upper = key.toUpperCase();
    const charCode = upper.charCodeAt(0);
    if (charCode >= 65 && charCode <= 90) {
      return WPF_KEY_A + (charCode - 65);
    }
    if (charCode >= 48 && charCode <= 57) {
      return WPF_KEY_D0 + (charCode - 48);
    }
  }

  if (code.startsWith("Key") && code.length === 4) {
    const charCode = code.toUpperCase().charCodeAt(3);
    if (charCode >= 65 && charCode <= 90) {
      return WPF_KEY_A + (charCode - 65);
    }
  }

  if (code.startsWith("Digit") && code.length === 6) {
    const digit = Number(code.slice(5));
    if (Number.isInteger(digit) && digit >= 0 && digit <= 9) {
      return WPF_KEY_D0 + digit;
    }
  }

  if (code && code in OEM_CODE_MAP) {
    return OEM_CODE_MAP[code];
  }

  if (key.length === 1) {
    return SYNTHETIC_CHAR_OFFSET + key.toUpperCase().charCodeAt(0);
  }

  return 0;
}

// Liefert eine lesbare Beschriftung für einen WPF-KeyCode
export function wpfKeyCodeToLabel(keyCode: number): string {
  if (keyCode <= 0) {
    return "";
  }
  if (keyCode in KEY_LABELS) {
    return KEY_LABELS[keyCode];
  }
  if (keyCode >= WPF_KEY_D0 && keyCode <= WPF_KEY_D0 + 9) {
    return String(keyCode - WPF_KEY_D0);
  }
  if (keyCode >= WPF_KEY_A && keyCode <= WPF_KEY_A + 25) {
    return String.fromCharCode(65 + (keyCode - WPF_KEY_A));
  }
  if (keyCode >= WPF_KEY_NUMPAD0 && keyCode <= WPF_KEY_NUMPAD0 + 9) {
    return `Num ${keyCode - WPF_KEY_NUMPAD0}`;
  }
  if (keyCode >= WPF_KEY_F1 && keyCode <= WPF_KEY_F1 + 11) {
    return `F${1 + (keyCode - WPF_KEY_F1)}`;
  }
  if (keyCode > SYNTHETIC_CHAR_OFFSET) {
    return String.fromCharCode(keyCode - SYNTHETIC_CHAR_OFFSET);
  }
  return `Key(${keyCode})`;
}

// Formatiert KeyCode und Modifiers als kompaktes Kürzel (z. B. "Strg+Shift+A")
export function formatKeyGesture(keyCode: number, modifiers: number): string {
  const keyLabel = wpfKeyCodeToLabel(keyCode);
  if (!keyLabel) {
    return "";
  }
  const parts: string[] = [];
  if ((modifiers & MODIFIER_CONTROL) !== 0) {
    parts.push("Strg");
  }
  if ((modifiers & MODIFIER_ALT) !== 0) {
    parts.push("Alt");
  }
  if ((modifiers & MODIFIER_SHIFT) !== 0) {
    parts.push("Shift");
  }
  if ((modifiers & MODIFIER_META) !== 0) {
    parts.push("Win");
  }
  parts.push(keyLabel);
  return parts.join("+");
}

// Prüft, ob ein KeyboardEvent exakt zu einer Button-Tastenbelegung passt
export function matchesKeyGesture(
  event: KeyboardGestureEventLike,
  keyCode: number,
  modifiers: number,
): boolean {
  if (keyCode <= 0) {
    return false;
  }
  return (
    keyboardEventToWpfKeyCode(event) === keyCode
    && getKeyboardEventModifiers(event) === modifiers
  );
}
