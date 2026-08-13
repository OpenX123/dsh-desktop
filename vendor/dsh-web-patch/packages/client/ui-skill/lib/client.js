window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-skill",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		//#region \0dsh-css:/Users/bruce/Documents/vscode-projects/test-bruc3van/packages/client/ui-skill/src/client/SkillRow.module.css.mjs
		const css$1 = ".cgriya_card{flex-direction:column;display:flex}.cgriya_row{align-items:center;min-width:0;height:24px;display:flex;position:relative;overflow:hidden}.cgriya_row[data-expandable]{cursor:pointer}.cgriya_card[data-state=running] .cgriya_row:after{content:\"\";background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite cgriya_dsh-skill-row-sweep;position:absolute;inset:0 auto 0 0}@keyframes cgriya_dsh-skill-row-sweep{0%{left:-300px}90%,to{left:100%}}.cgriya_leading{width:16px;height:16px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;margin-right:6px;display:inline-flex;position:relative}.cgriya_chevron{color:var(--dsw-alias-label-secondary)}.cgriya_iconIdle{opacity:1;transition:opacity .1s;display:inline-flex}.cgriya_chevronHover{opacity:0;margin:auto;transition:opacity .1s;position:absolute;inset:0}.cgriya_row:hover .cgriya_iconIdle{opacity:0}.cgriya_row:hover .cgriya_chevronHover{opacity:1}.cgriya_title{color:var(--dsw-alias-label-secondary);flex:none;font-size:14px;line-height:24px}.cgriya_separator{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.cgriya_summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;font-size:14px;line-height:24px;overflow:hidden}.cgriya_errorSummary{color:var(--dsw-alias-state-error-primary)}.cgriya_bodyWrap{flex-direction:column;display:flex}.cgriya_instructionsCard{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);border-radius:12px;flex-direction:column;max-height:260px;margin:4px 0 4px 4px;display:flex;overflow:hidden}.cgriya_instructionsHeader{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-markdown-code-block-banner);color:var(--dsw-alias-label-caption);text-transform:uppercase;letter-spacing:.04em;flex:none;padding:8px 12px;font-size:11px;font-weight:500;line-height:16px}.cgriya_instructions{white-space:pre-wrap;overflow-wrap:anywhere;min-height:0;font:var(--dsw-font-markdown-code-block-small);color:var(--dsw-alias-label-secondary);margin:0;padding:10px 12px 12px;overflow:auto}.cgriya_instructions[data-error]{color:var(--dsw-alias-state-error-primary)}.cgriya_instructions::-webkit-scrollbar-thumb{background-clip:padding-box;border:2px solid #0000;border-radius:6px}.cgriya_instructions::-webkit-scrollbar-track{margin:6px 0}.cgriya_inspectButton{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0;border-radius:999px;align-self:flex-start;align-items:center;gap:4px;margin:4px 0 2px 4px;padding:2px 8px;font-size:11px;line-height:16px;transition:opacity .1s;display:inline-flex}.cgriya_card:hover .cgriya_inspectButton,.cgriya_inspectButton:focus-visible{opacity:1}.cgriya_inspectButton:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}.cgriya_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}@media (prefers-reduced-motion:reduce){.cgriya_card[data-state=running] .cgriya_row:after{animation:none;display:none}.cgriya_iconIdle,.cgriya_chevronHover,.cgriya_inspectButton{transition:none}}";
		const tagId$1 = "@deepseek-ai/dsh-client-ui-skill/SkillRow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-skill";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var SkillRow_module_css_default = {
			"summary": "cgriya_summary",
			"visuallyHidden": "cgriya_visuallyHidden",
			"leading": "cgriya_leading",
			"errorSummary": "cgriya_errorSummary",
			"iconIdle": "cgriya_iconIdle",
			"separator": "cgriya_separator",
			"instructionsCard": "cgriya_instructionsCard",
			"dsh-skill-row-sweep": "cgriya_dsh-skill-row-sweep",
			"bodyWrap": "cgriya_bodyWrap",
			"row": "cgriya_row",
			"chevronHover": "cgriya_chevronHover",
			"title": "cgriya_title",
			"chevron": "cgriya_chevron",
			"inspectButton": "cgriya_inspectButton",
			"instructions": "cgriya_instructions",
			"instructionsHeader": "cgriya_instructionsHeader",
			"card": "cgriya_card"
		};
		//#endregion
		//#region lib/types/client/SkillRow.js
		/** First physical line for the collapsed error summary and malformed-args fallback. */
		function firstLine(text) {
			const newline = text.indexOf("\n");
			return newline === -1 ? text : text.slice(0, newline);
		}
		/** Skill names are the only call argument the compact row presents. */
		function skillName(argsRaw, callId) {
			try {
				const parsed = JSON.parse(argsRaw);
				if (typeof parsed === "object" && parsed !== null) {
					const name = parsed.name;
					if (typeof name === "string" && name !== "") return firstLine(name);
				}
			} catch {}
			return argsRaw === "" ? callId : firstLine(argsRaw);
		}
		/** Flatten durable result blocks under the generic Tool-row text contract.
		*  Keep aligned with ui-tool's models/tool-call-model.ts `resultText`. */
		function resultText(block) {
			if (!("kind" in block)) return null;
			const parts = [];
			for (const item of block.content) parts.push(item.type === "text" ? item.text : JSON.stringify(item, null, 2));
			if (parts.length === 0 && block.error !== void 0) parts.push(`${block.error.name}: ${block.error.code}`);
			return parts.join("\n") || null;
		}
		/** Derive display state without consulting the live skill catalog. */
		function skillRowModel(block) {
			const settled = "kind" in block;
			const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? "";
			const state = !settled ? "running" : block.error?.code === "interrupted" ? "stopped" : block.isError ? "error" : "ok";
			const output = resultText(block);
			return {
				name: skillName(argsRaw, block.callId),
				output,
				errorSummary: state === "error" && output !== null ? firstLine(output) : null,
				state
			};
		}
		/** State substitution for the collapsed leading slot. */
		function leadingFor(state) {
			switch (state) {
				case "error": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" });
				case "stopped": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "warning" });
				default: return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSkillOutline16, { size: 14 });
			}
		}
		/** Leading disclosure slot: state icon at rest, chevron on hover or while open. */
		function disclosureLeading(state, open, expandable) {
			if (open) return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { className: SkillRow_module_css_default.chevron });
			const icon = leadingFor(state);
			if (!expandable) return icon;
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
				className: SkillRow_module_css_default.iconIdle,
				children: icon
			}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { className: `${SkillRow_module_css_default.chevron} ${SkillRow_module_css_default.chevronHover}` })] });
		}
		/** Visually hidden state copy for the colour-only lifecycle cues. */
		function stateStatus(state, t) {
			switch (state) {
				case "running": return t("row.running");
				case "error": return t("row.failed");
				case "stopped": return t("row.stopped");
				default: return null;
			}
		}
		/**
		* Render one `skill` tool call as an accent summary and instructions disclosure.
		* @param props - keyed toolview payload plus the skill locale seat.
		* @returns the dedicated skill row.
		*/
		function SkillRow$1({ block, inspect, t }) {
			const model = skillRowModel(block);
			const [expanded, setExpanded] = (0, react.useState)(false);
			const expandable = model.output !== null;
			const open = expanded && expandable;
			const status = stateStatus(model.state, t);
			const summary = model.errorSummary ?? model.name;
			const toggleExpand = () => {
				setExpanded((value) => !value);
			};
			const toggleFromKeyboard = (event) => {
				if (!expandable || event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				toggleExpand();
			};
			const disclosureProps = expandable ? {
				role: "button",
				tabIndex: 0,
				"aria-expanded": open,
				onClick: toggleExpand,
				onKeyDown: toggleFromKeyboard
			} : {};
			const leading = disclosureLeading(model.state, open, expandable);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: SkillRow_module_css_default.card,
				"data-tool": "skill",
				"data-state": model.state,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: SkillRow_module_css_default.row,
					"data-expandable": expandable || void 0,
					...disclosureProps,
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: SkillRow_module_css_default.leading,
							children: leading
						}),
						status !== null ? (0, react_jsx_runtime.jsx)("span", {
							className: SkillRow_module_css_default.visuallyHidden,
							children: status
						}) : null,
						(0, react_jsx_runtime.jsx)("span", {
							className: SkillRow_module_css_default.title,
							children: "Skill"
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: SkillRow_module_css_default.separator,
							"aria-hidden": true
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: model.errorSummary === null ? SkillRow_module_css_default.summary : `${SkillRow_module_css_default.summary} ${SkillRow_module_css_default.errorSummary}`,
							children: summary
						})
					]
				}), open ? (0, react_jsx_runtime.jsxs)("div", {
					className: SkillRow_module_css_default.bodyWrap,
					children: [(0, react_jsx_runtime.jsxs)("section", {
						className: SkillRow_module_css_default.instructionsCard,
						"aria-label": t("row.instructions"),
						children: [(0, react_jsx_runtime.jsx)("div", {
							className: SkillRow_module_css_default.instructionsHeader,
							children: t("row.instructions")
						}), (0, react_jsx_runtime.jsx)("pre", {
							className: SkillRow_module_css_default.instructions,
							"data-error": model.state === "error" || void 0,
							children: model.output
						})]
					}), inspect !== void 0 ? (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: SkillRow_module_css_default.inspectButton,
						onClick: inspect,
						children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconInspectOutline12, {}), "Inspect"]
					}) : null]
				}) : null]
			});
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region \0dsh-css:/Users/bruce/Documents/vscode-projects/test-bruc3van/packages/client/ui-skill/src/client/SkillsSection.module.css.mjs
		const css = ".wi45dq_section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}.wi45dq_heading{margin:0;font-size:18px;font-weight:600}.wi45dq_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}.wi45dq_rows{flex-direction:column;gap:10px;margin:0;padding:0;list-style:none;display:flex}.wi45dq_row{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;justify-content:space-between;align-items:flex-start;gap:12px;padding:12px 16px;display:flex}.wi45dq_row:hover{border-color:var(--dsw-alias-label-dimmed)}.wi45dq_rowDisabled{opacity:.72}.wi45dq_rowBody{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.wi45dq_rowTitle{align-items:center;gap:8px;display:flex}.wi45dq_rowName{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600}.wi45dq_badge{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:999px;padding:1px 8px;font-size:11px;line-height:1.4}.wi45dq_badgeMuted{color:var(--dsw-alias-label-tertiary)}.wi45dq_rowDescription{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px}.wi45dq_rowPath{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0;font-size:12px}.wi45dq_rowActions{flex-shrink:0;align-items:center;gap:8px;display:flex}.wi45dq_action{appearance:none;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border-radius:28px;padding:5px 12px;font-size:13px;transition:background .15s,border-color .15s}.wi45dq_action:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.wi45dq_action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.wi45dq_action:disabled{opacity:.45;cursor:default}.wi45dq_actionDanger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}.wi45dq_empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}.wi45dq_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px}";
		const tagId = "@deepseek-ai/dsh-client-ui-skill/SkillsSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-skill";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SkillsSection_module_css_default = {
			"badge": "wi45dq_badge",
			"section": "wi45dq_section",
			"rowBody": "wi45dq_rowBody",
			"rowActions": "wi45dq_rowActions",
			"actionDanger": "wi45dq_actionDanger",
			"rowName": "wi45dq_rowName",
			"error": "wi45dq_error",
			"empty": "wi45dq_empty",
			"rowDescription": "wi45dq_rowDescription",
			"row": "wi45dq_row",
			"rows": "wi45dq_rows",
			"rowDisabled": "wi45dq_rowDisabled",
			"badgeMuted": "wi45dq_badgeMuted",
			"action": "wi45dq_action",
			"heading": "wi45dq_heading",
			"rowPath": "wi45dq_rowPath",
			"rowTitle": "wi45dq_rowTitle",
			"intro": "wi45dq_intro"
		};
		//#endregion
		//#region lib/types/client/SkillsSection.js
		/**
		* Skills management settings section: the catalog list with per-skill
		* enable/disable and (confirmed) delete controls. Data and mutations ride
		* the injected controller face; the section itself only presents them.
		*/
		/** One catalog row with its management controls. */
		function SkillRow({ skill, busy, confirming, t, onToggle, onConfirm, onCancelConfirm, onRemove }) {
			const rowBusy = busy;
			return (0, react_jsx_runtime.jsxs)("li", {
				className: clsx(SkillsSection_module_css_default.row, skill.disabled && SkillsSection_module_css_default.rowDisabled),
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: SkillsSection_module_css_default.rowBody,
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: SkillsSection_module_css_default.rowTitle,
							children: [
								(0, react_jsx_runtime.jsxs)("span", {
									className: SkillsSection_module_css_default.rowName,
									children: ["/", skill.name]
								}),
								!skill.modelInvocable && (0, react_jsx_runtime.jsx)("span", {
									className: SkillsSection_module_css_default.badge,
									children: t("settings.userOnlyBadge")
								}),
								skill.disabled && (0, react_jsx_runtime.jsx)("span", {
									className: clsx(SkillsSection_module_css_default.badge, SkillsSection_module_css_default.badgeMuted),
									children: t("settings.disabledBadge")
								})
							]
						}),
						skill.description !== "" && (0, react_jsx_runtime.jsx)("p", {
							className: SkillsSection_module_css_default.rowDescription,
							children: skill.description
						}),
						skill.deletable.kind === "local" ? (0, react_jsx_runtime.jsx)("p", {
							className: SkillsSection_module_css_default.rowPath,
							children: skill.deletable.path
						}) : (0, react_jsx_runtime.jsx)("p", {
							className: SkillsSection_module_css_default.rowPath,
							children: t("settings.notDeletableBadge")
						})
					]
				}), (0, react_jsx_runtime.jsx)("div", {
					className: SkillsSection_module_css_default.rowActions,
					children: confirming ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: clsx(SkillsSection_module_css_default.action, SkillsSection_module_css_default.actionDanger),
						disabled: rowBusy,
						onClick: () => {
							onRemove(skill.name);
						},
						children: t("settings.confirmDelete")
					}), (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: SkillsSection_module_css_default.action,
						disabled: rowBusy,
						onClick: onCancelConfirm,
						children: t("settings.cancel")
					})] }) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: SkillsSection_module_css_default.action,
						disabled: rowBusy,
						onClick: () => {
							onToggle(skill.name, skill.disabled);
						},
						children: skill.disabled ? t("settings.enable") : t("settings.disable")
					}), (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: SkillsSection_module_css_default.action,
						disabled: rowBusy || skill.deletable.kind !== "local",
						onClick: () => {
							onConfirm(skill.name);
						},
						children: t("settings.delete")
					})] })
				})]
			});
		}
		/**
		* Render the skills management section.
		* @param props - locale copy and the injected controller face.
		* @returns the section.
		*/
		function SkillsSection(props) {
			const { t } = props;
			const state = props.useSkillsSection((snapshot) => snapshot);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: SkillsSection_module_css_default.section,
				children: [
					(0, react_jsx_runtime.jsx)("h2", {
						className: SkillsSection_module_css_default.heading,
						children: t("settings.title")
					}),
					(0, react_jsx_runtime.jsx)("p", {
						className: SkillsSection_module_css_default.intro,
						children: t("settings.intro")
					}),
					state.error !== null && (0, react_jsx_runtime.jsx)("p", {
						className: SkillsSection_module_css_default.error,
						children: t(state.skills.length === 0 ? "settings.loadFailed" : "settings.mutationFailed", { message: state.error })
					}),
					state.loading ? (0, react_jsx_runtime.jsx)("p", {
						className: SkillsSection_module_css_default.empty,
						children: t("settings.loading")
					}) : state.skills.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: SkillsSection_module_css_default.empty,
						children: t("settings.empty")
					}) : (0, react_jsx_runtime.jsx)("ul", {
						className: SkillsSection_module_css_default.rows,
						children: state.skills.map((skill) => (0, react_jsx_runtime.jsx)(SkillRow, {
							skill,
							busy: state.busy === skill.name,
							confirming: state.confirming === skill.name,
							t,
							onToggle: props.setEnabled,
							onConfirm: props.confirm,
							onCancelConfirm: props.cancelConfirm,
							onRemove: props.remove
						}, skill.name))
					}),
					(0, react_jsx_runtime.jsx)("div", { children: (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: SkillsSection_module_css_default.action,
						onClick: props.refresh,
						children: t("settings.refresh")
					}) })
				]
			});
		}
		//#endregion
		//#region lib/types/client/skills-section-store.js
		/**
		* Skills management section model: the catalog fetch lifecycle and the
		* per-row mutations (enable/disable, delete) over the skill.admin* RPCs.
		*
		* The section renders from one snapshot store; every mutation marks its row
		* busy while crossing the wire, then patches the row in place — the Host is
		* the authority, so a failed call restores the previous row and surfaces the
		* message. Deletion is a two-step gesture (confirm, then commit) owned by
		* this model rather than a browser confirm().
		*/
		/** Bridges the skill management RPCs onto the section's snapshot store. */
		var SkillsSectionController = class {
			deps;
			store;
			state = {
				loading: true,
				error: null,
				skills: [],
				busy: null,
				confirming: null
			};
			/** @param deps - transport faces bound to the plugin's root context. */
			constructor(deps) {
				this.deps = deps;
				this.store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(this.state);
				this.refresh();
			}
			/** Build the face the section's slot registration injects. */
			inject() {
				return {
					refresh: () => {
						this.refresh();
					},
					setEnabled: (name, enabled) => {
						this.toggle(name, enabled);
					},
					confirm: (name) => {
						this.publish({ confirming: name });
					},
					cancelConfirm: () => {
						if (this.state.confirming !== null) this.publish({ confirming: null });
					},
					remove: (name) => {
						this.delete(name);
					},
					hooks: { skillsSection: this.store }
				};
			}
			/** Fetch the catalog; a refresh keeps current rows visible while in flight. */
			async refresh() {
				if (this.state.skills.length === 0) this.publish({
					loading: true,
					error: null
				});
				try {
					const skills = await this.deps.list();
					this.publish({
						loading: false,
						error: null,
						skills
					});
				} catch (error) {
					this.publish({
						loading: false,
						error: errorMessage(error)
					});
				}
			}
			/** Disable or re-enable one skill, patching the row once the Host accepted it. */
			async toggle(name, enabled) {
				if (this.state.busy !== null) return;
				this.publish({
					busy: name,
					error: null,
					confirming: null
				});
				try {
					await this.deps.setEnabled(name, enabled);
					this.patch(name, { disabled: !enabled });
					this.publish({ busy: null });
					this.deps.onChanged();
				} catch (error) {
					this.publish({
						busy: null,
						error: errorMessage(error)
					});
				}
			}
			/** Delete one skill after its confirmation step. */
			async delete(name) {
				if (this.state.busy !== null) return;
				this.publish({
					busy: name,
					error: null,
					confirming: null
				});
				try {
					await this.deps.remove(name);
					this.publish({
						busy: null,
						skills: this.state.skills.filter((skill) => skill.name !== name)
					});
					this.deps.onChanged();
				} catch (error) {
					this.publish({
						busy: null,
						error: errorMessage(error)
					});
				}
			}
			/** Patch one row's management fields in place (never the catalog identity). */
			patch(name, over) {
				this.publish({ skills: this.state.skills.map((skill) => skill.name === name ? {
					...skill,
					...over
				} : skill) });
			}
			/** Merge one state delta and republish as a fresh snapshot reference. */
			publish(delta) {
				this.state = {
					...this.state,
					...delta
				};
				this.store.set(this.state);
			}
		};
		/** Render an arbitrary failure without trusting coercion. */
		function errorMessage(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		//#region lib/types/client/locales.js
		/**
		* `skill` namespace dictionaries: the dedicated tool row plus the settings
		* management section (`skill` doubles as the section's locale namespace).
		*/
		/** Dictionary namespace owned by this plugin. */
		const NS = "skill";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"row.running": "正在加载 skill",
			"row.failed": "skill 加载失败",
			"row.stopped": "skill 加载已中止",
			"row.instructions": "说明",
			"menu.userOnly": "仅用户",
			"settings.nav": "技能管理",
			"settings.title": "技能管理",
			"settings.intro": "查看、禁用或删除本机技能。禁用的技能不会出现在输入框的 / 菜单中；删除会移除本机技能文件。",
			"settings.loading": "正在加载技能…",
			"settings.empty": "没有发现技能。将技能放入技能目录后会自动出现在这里。",
			"settings.loadFailed": "加载失败：{message}",
			"settings.mutationFailed": "操作失败：{message}",
			"settings.refresh": "刷新",
			"settings.enable": "启用",
			"settings.disable": "禁用",
			"settings.delete": "删除",
			"settings.confirmDelete": "确认删除",
			"settings.cancel": "取消",
			"settings.disabledBadge": "已禁用",
			"settings.userOnlyBadge": "仅用户",
			"settings.notDeletableBadge": "不可删除"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"row.running": "Loading skill",
			"row.failed": "Skill load failed",
			"row.stopped": "Skill load stopped",
			"row.instructions": "Instructions",
			"menu.userOnly": "user-only",
			"settings.nav": "Skills",
			"settings.title": "Skills",
			"settings.intro": "View, disable, or delete local skills. Disabled skills leave the / menu in the composer; deleting removes the skill files from this machine.",
			"settings.loading": "Loading skills…",
			"settings.empty": "No skills found. Skills placed in a skill directory appear here automatically.",
			"settings.loadFailed": "Load failed: {message}",
			"settings.mutationFailed": "Action failed: {message}",
			"settings.refresh": "Refresh",
			"settings.enable": "Enable",
			"settings.disable": "Disable",
			"settings.delete": "Delete",
			"settings.confirmDelete": "Confirm delete",
			"settings.cancel": "Cancel",
			"settings.disabledBadge": "disabled",
			"settings.userOnlyBadge": "user-only",
			"settings.notDeletableBadge": "not deletable"
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Required services: reference source faces plus the tool-row and locale registries. */
		const inject = [
			"slash",
			"connection",
			"sessions",
			"slots",
			"locale",
			"remote"
		];
		/**
		* Client plugin body: register the '/' source, dictionaries, and keyed tool row.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-skill: dictionaries");
			ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
				name: "tool.call.toolview",
				key: "skill",
				locale: NS
			}, SkillRow$1));
			const skills = ctx.get("connection").api.skills;
			const sessions = ctx.get("sessions");
			const fetches = /* @__PURE__ */ new Map();
			const lexiconListeners = /* @__PURE__ */ new Map();
			const notifyLexicon = (sessionId) => {
				for (const listener of [...lexiconListeners.get(sessionId) ?? []]) try {
					listener();
				} catch (error) {
					console.error("[ui-skill] lexicon listener failed:", error);
				}
			};
			const fetchCatalog = (sessionId) => {
				if (sessions.subagentAddress(sessionId) !== void 0) return Promise.resolve([]);
				const existing = fetches.get(sessionId);
				if (existing !== void 0) return existing.promise;
				const abort = new AbortController();
				const promise = (async () => {
					const { result } = await skills.list({ sessionId }, abort.signal);
					if (!result.ok) throw new Error(`skill.list failed: ${result.error.code}: ${result.error.message}`);
					return result.value.skills;
				})();
				const entry = {
					promise,
					abort
				};
				fetches.set(sessionId, entry);
				promise.then((skills) => {
					entry.settled = skills;
					notifyLexicon(sessionId);
				}, () => {
					if (fetches.get(sessionId) === entry) fetches.delete(sessionId);
				});
				return promise;
			};
			const invalidate = (key) => {
				const entry = fetches.get(key);
				if (entry === void 0) return;
				fetches.delete(key);
				entry.abort.abort();
				notifyLexicon(key);
			};
			const clearAll = () => {
				for (const key of [...fetches.keys()]) invalidate(key);
			};
			const t = ctx.locale.bind(NS);
			const source = {
				trigger: "/",
				name: "skill",
				order: 2,
				async candidates(session, { query, signal }) {
					const skills = await fetchCatalog(session.sessionId);
					if (signal.aborted) return [];
					return skills.filter((skill) => skill.name.startsWith(query)).map((skill) => ({
						name: skill.name,
						description: skill.modelInvocable ? skill.description : `${t("menu.userOnly")} · ${skill.description}`
					}));
				},
				warm(session) {
					fetchCatalog(session.sessionId).catch(() => {});
				},
				lexicon(session) {
					return fetches.get(session.sessionId)?.settled?.map((skill) => skill.name);
				},
				subscribeLexicon(session, listener) {
					const key = session.sessionId;
					const listeners = lexiconListeners.get(key) ?? /* @__PURE__ */ new Set();
					listeners.add(listener);
					lexiconListeners.set(key, listeners);
					return () => {
						listeners.delete(listener);
						if (listeners.size === 0) lexiconListeners.delete(key);
					};
				},
				onPick({ candidate }) {
					return { text: `/${candidate.name} ` };
				}
			};
			const slash = ctx.get("slash");
			ctx.remote.$on("agent-preset/selected", invalidate);
			ctx.remote.$on("skills/change", clearAll);
			ctx.on("connection/reset", clearAll);
			ctx.effect(() => {
				const unregister = slash.registerSource(source);
				return () => {
					unregister();
					clearAll();
				};
			}, "ui-skill: source");
			const section = new SkillsSectionController({
				async list() {
					const { result } = await skills.adminList({});
					if (!result.ok) throw new Error(`skill.adminList failed: ${result.error.code}: ${result.error.message}`);
					return result.value.skills;
				},
				async setEnabled(name, enabled) {
					const { result } = await skills.setEnabled({
						name,
						enabled
					});
					if (!result.ok) throw new Error(`skill.setEnabled failed: ${result.error.code}: ${result.error.message}`);
				},
				async remove(name) {
					const { result } = await skills.remove({ name });
					if (!result.ok) throw new Error(`skill.remove failed: ${result.error.code}: ${result.error.message}`);
				},
				onChanged: clearAll
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skills",
				order: 40,
				label: () => t("settings.nav"),
				locale: NS,
				inject: () => section.inject()
			}, SkillsSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map