# Landing story refinement

Akshar requested this local pass after the PR139 checkpoint. PR139 was merged with all checks green. Akshar subsequently requested pushing and merging this newer landing as the actual homepage, preserving all other changes and avoiding force overwrites. The homepage serves the refined story at /, while the earlier preview assets and demo routes remain available. Open BizBox goes through /start so it creates or resumes the founder’s own project.

## Agreed experience

Retain Houston, canonical BizBox branding, translucent rimmed glass, the actual Vexcel map and authored seeded scenario. Replace the oversized light headline composition with a compact, stronger non-serif hierarchy using the bundled DM Sans. Scale the MacBook and its aperture together through the existing camera projection, preserving the continuous fullscreen entry and reverse seek.

After entry settles, the seven-second business setup demonstrates selecting a café, writing the detailed business brief, moving a real range input from $3,500 to $4,500, adjusting the shift to the scenario's one person and confirming the brief. These are authored demonstration inputs, not new persisted user onboarding. Reduced motion shows the confirmed brief. The earlier landing-demo route retains its existing onboarding.

All story chat follows one interaction pattern: a real-looking composer types the question, visibly sends it, places a right-aligned user bubble and receives a separate left-aligned BizBox reply. Apply to the location question, higher-rent question and second-counter question. Avoid labels/prose that do not explain an action or result.

A bounded desktop-style horizontal swipe connects the location conversation to the map, and continues to connect map and analytics. Two property facts appear progressively as anchored translucent cards, with legible heading contrast and visible road samples. Show comparisons with aligned visual values for customers served and contribution, preserving the existing scenario calculations and expandable assumptions.

The higher-rent reply contains the interior preview and See inside action. The same generated image expands from the response into the room, then persists into the counter question. This is generated imagery, not a Matterport scan. Keep the split one/two-counter result and prominent difference strip. Preserve selection, replay, pause, keyboard, resize, hidden-document and reduced-motion behavior.

## Implementation choices

Use a shared story chat component and pure timeline state rather than separate ad-hoc bubbles. Keep heavy 3D resources mounted only when visible or temporarily retained for an active transition. Extend cameraAt with optional hero composition settings; omitted settings preserve the earlier route exactly. No new dependencies, services, API contracts or real property claims.

## Verification

Pure checks cover scripted input progression/reversal, confirmed endpoints and shared camera alignment. Chat state tests cover composer, send, reply and reduced motion. Verify desktop, phone and short landscape layouts, no horizontal overflow, readable headings, prompt/map reversal, image continuity, visible inputs, selection and motion gates in the browser. Run repository lint/typecheck/unit/build after integration. Update the landing handoff with evidence and limitations.
