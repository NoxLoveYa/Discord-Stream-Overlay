/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { type EncoderInfo, explainEncoder } from "@plugins/streamOverlay.desktop/encoders";
import { Native, settings } from "@plugins/streamOverlay.desktop/settings";
import { streamState } from "@plugins/streamOverlay.desktop/streamState";
import { copyWithToast } from "@utils/discord";
import { useEffect, useState } from "@webpack/common";

/** Which encoder Discord uses for the stream (from its own log), and a report to copy when "stream only" does not work. */
export function Diagnostics() {
    const { overlayRoot, enabledOverlays, streamOnly } = settings.use(["overlayRoot", "enabledOverlays", "streamOnly"]);
    // undefined: not looked at yet, null: Discord's log does not say
    const [encoder, setEncoder] = useState<EncoderInfo | null | undefined>(undefined);

    const check = () => Native.streamEncoder().then(setEncoder, () => setEncoder(null));
    useEffect(() => void check(), []);

    // what only this page knows, put at the top of the report
    const extra = () => [
        `stream only is ${streamOnly ? "on" : "off"}; the encoder hook is ${streamState.hooked ? "in" : "not in"}`,
        streamState.failed ? `stream only was given up for the stream that is running: ${streamState.failed}` : "stream only has not been given up for the stream that is running",
        `overlays on: ${[...enabledOverlays].join(", ") || "none"}`,
        `overlays folder: ${overlayRoot || "(the default one)"}`
    ].join("\n");

    async function copy() {
        await copyWithToast(await Native.diagnostics(extra()), "Diagnostics copied: paste them where you were asked to");
    }

    return (
        <>
            <Paragraph size="sm" defaultColor={false} className="vc-so-muted">
                {encoder === undefined
                    ? "Looking at Discord's log..."
                    : `${explainEncoder(encoder)}.${encoder?.backend && !encoder.supported ? " The overlays go on your screen instead while it is in use." : ""}`}
            </Paragraph>
            {streamState.idle && (
                <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                    Stream only is waiting: Discord encodes nothing while nobody is watching your stream, so there is nothing to draw on yet.
                </Paragraph>
            )}
            {streamState.failed && (
                <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                    Stream only was given up for the stream that is running: {streamState.failed}.
                </Paragraph>
            )}
            <div className="vc-so-buttons">
                <Button size="small" onClick={copy}>Copy diagnostics</Button>
                <Button size="small" variant="secondary" onClick={check}>Look again</Button>
            </div>
            <Paragraph size="sm" defaultColor={false} className="vc-so-muted vc-so-hint">
                The report has the graphics cards and which has the screens, the encoders Discord found and tried, what the native hook
                saw (sessions, textures, frames) and the last lines of the logs. Start a stream with an overlay on, wait about 15 seconds,
                then copy it.
            </Paragraph>
        </>
    );
}
