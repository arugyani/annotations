import {
  PluginSettingTab,
  Setting,
  type Plugin,
  type ColorComponent,
  type TextComponent,
  type ToggleComponent,
  type DropdownComponent,
} from "obsidian";
import { COLORS, type Color } from "./model";
import {
  PRESETS,
  PALETTE_EVENT,
  hexColor,
  paletteColors,
  type AnnotationSettings,
  type Palette,
} from "./settings";

export interface PaletteHost {
  paletteSettings: AnnotationSettings;
  setSettings(settings: AnnotationSettings): void;
  applyPalette(document: Document): void;
}
export class CommentsSettings extends PluginSettingTab {
  private cleanups = new Set<() => void>();
  constructor(private owner: Plugin & PaletteHost) {
    super(owner.app, owner);
    owner.register(() => this.hide());
  }
  getSettingDefinitions() {
    return [
      {
        name: "Highlight palette",
        desc: "Select a color to customize it.",
        render: (setting: Setting) => this.palette(setting),
      },
    ];
  }
  display() {
    this.hide();
    this.containerEl.empty();
    for (const definition of this.getSettingDefinitions())
      definition.render(
        new Setting(this.containerEl)
          .setName(definition.name)
          .setDesc(definition.desc),
      );
  }
  hide() {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.clear();
  }
  private palette(setting: Setting) {
    setting.settingEl.addClass("comments-palette-setting");
    const document = setting.settingEl.ownerDocument;
    this.owner.applyPalette(document);
    let selected: Color | undefined,
      syncing = false;
    let dropdown: DropdownComponent;
    let inputs:
      | { picker: ColorComponent; text: TextComponent; toggle: ToggleComponent }
      | undefined;
    const swatches = new Map<Color, HTMLButtonElement>();
    setting.addDropdown((control) => {
      dropdown = control;
      for (const [id, preset] of Object.entries(PRESETS))
        control.addOption(id, preset.name);
      control.addOption("custom", "Custom");
      control.selectEl.setAttribute("aria-label", "Highlight palette");
      control.onChange((value) => {
        if (!syncing)
          this.owner.setSettings({
            ...this.owner.paletteSettings,
            palette: value as Palette,
          });
      });
    });
    setting.addExtraButton((button) =>
      button
        .setIcon("rotate-ccw")
        .setTooltip("Reset palette")
        .onClick(() =>
          this.owner.setSettings({
            palette: "classic",
            customColors: { ...PRESETS.classic.colors },
            visibleColors: [...COLORS],
          }),
        ),
    );
    const strip = setting.settingEl.createDiv({
      cls: "comments-palette-swatches",
    });
    strip.setAttribute("role", "group");
    strip.setAttribute("aria-label", "Palette colors");
    const editor = setting.settingEl.createDiv({
      cls: "comments-palette-editor",
    });
    editor.hidden = true;
    setting.settingEl.createDiv({
      cls: "comments-palette-hint",
      text: "Custom shades apply while Annotations is enabled.",
    });
    const sync = () => {
      // The host color picker can fire onChange from setValue.
      syncing = true;
      try {
        const settings = this.owner.paletteSettings;
        dropdown.setValue(settings.palette);
        for (const [color, button] of swatches) {
          button.setAttribute("aria-expanded", String(selected === color));
          button.classList.toggle(
            "is-omitted",
            !settings.visibleColors.includes(color),
          );
          button.setAttribute(
            "aria-label",
            `Customize ${color}${settings.visibleColors.includes(color) ? "" : " (hidden from pill)"}`,
          );
        }
        if (selected && inputs) {
          const hex = paletteColors(settings)[selected];
          inputs.picker.setValue(hex);
          inputs.text.setValue(hex);
          inputs.text.inputEl.removeAttribute("aria-invalid");
          inputs.toggle
            .setValue(settings.visibleColors.includes(selected))
            .setDisabled(
              settings.visibleColors.length === 1 &&
                settings.visibleColors.includes(selected),
            );
        }
      } finally {
        syncing = false;
      }
    };
    const edit = (color: Color) => {
      selected = selected === color ? undefined : color;
      inputs = undefined;
      editor.empty();
      editor.hidden = !selected;
      if (selected) {
        const row = new Setting(editor).setName(
          `${color[0].toUpperCase()}${color.slice(1)}`,
        );
        row.settingEl.addClass("comments-color-setting");
        const update = (value: string) => {
          const hex = hexColor(value);
          if (syncing || !hex) return;
          this.owner.setSettings({
            ...this.owner.paletteSettings,
            palette: "custom",
            customColors: {
              ...paletteColors(this.owner.paletteSettings),
              [color]: hex,
            },
          });
        };
        let picker!: ColorComponent,
          text!: TextComponent,
          toggle!: ToggleComponent;
        row.addColorPicker((control) => {
          picker = control;
          control.onChange(update);
          row.controlEl
            .querySelector('input[type="color"]')
            ?.setAttribute("aria-label", `${color} shade`);
        });
        row.addText((control) => {
          text = control;
          control.inputEl.addClass("comments-color-hex");
          control.inputEl.setAttribute("aria-label", `${color} hex color`);
          control.setPlaceholder("#RRGGBB").onChange((value) => {
            if (syncing) return;
            control.inputEl.setAttribute(
              "aria-invalid",
              String(!hexColor(value)),
            );
            update(value);
          });
        });
        const visibility = row.controlEl.createDiv({
          cls: "comments-palette-visibility",
        });
        visibility.createSpan({ text: "In pill" });
        row.addToggle((control) => {
          toggle = control;
          visibility.appendChild(control.toggleEl);
          control.setTooltip(`Show ${color} in the pill`);
          control.toggleEl.setAttribute(
            "aria-label",
            `Show ${color} in the pill`,
          );
          control.onChange((enabled) => {
            if (syncing) return;
            const visibleColors = COLORS.filter((c) =>
              c === color
                ? enabled
                : this.owner.paletteSettings.visibleColors.includes(c),
            );
            if (visibleColors.length)
              this.owner.setSettings({
                ...this.owner.paletteSettings,
                visibleColors,
              });
          });
        });
        inputs = { picker, text, toggle };
      }
      sync();
    };
    for (const color of COLORS) {
      const button = strip.createEl("button", {
        cls: `comments-palette-swatch comments-${color}`,
        attr: { type: "button", "aria-label": `Customize ${color}` },
      });
      button.createSpan();
      button.addEventListener("click", () => edit(color));
      swatches.set(color, button);
    }
    editor.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !selected) return;
      event.preventDefault();
      event.stopPropagation();
      const color = selected;
      edit(color);
      swatches.get(color)?.focus();
    });
    document.addEventListener(PALETTE_EVENT, sync);
    this.cleanups.add(() => document.removeEventListener(PALETTE_EVENT, sync));
    sync();
  }
}
