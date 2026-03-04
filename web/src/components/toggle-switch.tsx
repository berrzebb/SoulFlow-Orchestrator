interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

export function ToggleSwitch({ checked, onChange, disabled, "aria-label": ariaLabel }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`toggle-switch ${checked ? "toggle-switch--on" : ""}`}
    >
      <span className="toggle-switch__thumb" />
    </button>
  );
}
