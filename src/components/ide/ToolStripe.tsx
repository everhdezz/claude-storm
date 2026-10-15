import { Indicator, Tooltip, UnstyledButton } from "@mantine/core";
import type { Icon } from "@tabler/icons-react";
import classes from "./ide.module.css";

export interface StripeItem<T extends string> {
  id: T;
  label: string;
  icon: Icon;
  badge?: boolean;
}

interface ToolStripeProps<T extends string, B extends string> {
  top: StripeItem<T>[];
  bottom: StripeItem<B>[];
  activeTop: T[];
  activeBottom: B | null;
  onTop: (id: T) => void;
  onBottom: (id: B) => void;
}

/** Vertical icon bar on the window edge that toggles tool windows, like JetBrains IDEs. */
export function ToolStripe<T extends string, B extends string>(props: ToolStripeProps<T, B>) {
  return (
    <nav className={classes.stripe}>
      {props.top.map((item) => (
        <StripeButton key={item.id} item={item} active={props.activeTop.includes(item.id)} onClick={() => props.onTop(item.id)} />
      ))}
      <div style={{ flex: 1 }} />
      {props.bottom.map((item) => (
        <StripeButton
          key={item.id}
          item={item}
          active={props.activeBottom === item.id}
          onClick={() => props.onBottom(item.id)}
        />
      ))}
    </nav>
  );
}

/** One square icon button in the stripe. */
function StripeButton<T extends string>({ item, active, onClick }: { item: StripeItem<T>; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <Tooltip label={item.label} position="right" openDelay={300}>
      <UnstyledButton className={classes.stripeButton} data-active={active || undefined} onClick={onClick} aria-label={item.label}>
        <Indicator disabled={!item.badge} color="teal" size={7} offset={3} style={{ display: "flex" }}>
          <Icon size={20} stroke={1.6} style={{ display: "block" }} />
        </Indicator>
      </UnstyledButton>
    </Tooltip>
  );
}
