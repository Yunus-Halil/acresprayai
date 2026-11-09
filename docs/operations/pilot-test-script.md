# Pilot: the end-to-end test, as a participant would do it

Run this after `docs/operations/pilot-access.md` sections 1 to 5: the migrations applied, the functions deployed, the
Auth settings set. Use the branch's preview deployment, or `npm run dev` on `localhost:8080`. Do not use main.

Use two accounts:
- your founder account;
- a second address you own, which will be the participant. A Gmail "+pilot" alias works.

Write down anything that surprises you. Each step says what you should see.

## 1. Invitation and first sign-in

1. As the founder, open `/admin/pilot`. Invite the second address with a name and organisation.
   - **You should see:** "Invitation made", whether it was emailed, and the link with Copy.
2. In a private window, open the link (from the email, or pasted).
   - **You should see:** "Welcome to the Swardus pilot", signed in as that address, with a form to choose a password.
3. Set a password.
   - **You should see:** the pilot terms in brief and two unticked choices. The terms page carries the draft notice until you approve the wording.
4. Agree.
   - **You should see:** **Field Twins**, empty, with "Your first Field Twin".
   - **The menu should show only:** Field Twins, New Field Twin, Help, Feedback & Support, Units, Sign out.
5. Sign out, then sign in again with the password. Then try "Forgot your password?". The reset email needs custom SMTP (pilot-access.md 4.4).

## 2. Access the participant must not have

In the participant's window:
1. Type `/app/fields`, `/app/photo`, `/app/weather` and `/admin/pilot` into the address bar.
   - **You should see:** each one sends you to Field Twins.
2. Open `/app/twins/<one of the founder's twin ids>`.
   - **You should see:** "This Field Twin does not exist in your account".
3. On the pilot desk as the founder, **Pause** the participant, then reload their window.
   - **You should see:** "This account is not in the pilot". Restore them afterwards.
4. Sign in with Google using an address that was never invited.
   - **With sign-ups off, you should see:** "That account is not invited to the pilot".
   - **With sign-ups on, you should see:** "This account is not in the pilot".

## 3. A Field Twin from real photographs

Use a real flight, ideally a DJI corn flight with its own GPS headers. **That validation has not been done yet; this is where it happens.**

1. Open **New Field Twin**. Enter a name and choose **Corn**. Choose the flight's folder, or drop the photographs onto the page.
   - **You should see:** "Checking the photographs: n of N", then the check: how many can be used, the camera, cm per pixel, ground covered, flight date and position (GPS or RTK).
   - Any photograph left out appears with its reason.
   - Also try a folder that contains a video and a phone photo. Both should be counted, and Build should stay available.
2. Build.
   - **You should see:** plain stages with a count and elapsed time, and the "Keep this tab open" notice.
   - Click **Field Twins** in the menu. The amber banner says the build is running. Come back with **See progress**.
   - Try to close the tab. The browser asks first.
3. When it finishes, the twin opens by itself. The header says "Saving to your account… keep this tab open", then the message goes away.
   - **Note:** the build time, and whether the computer slowed down. These numbers set `PILOT_LIMITS` in `src/lib/fieldTwin/preflight.ts`.
4. In the viewer, check four things:
   - The key says "Review-only" and states whether the position is GPS or RTK.
   - There are only two views: Simple and Standard.
   - Clicking a corn weed candidate shows "Your review" above its photographs.
   - Answer **Wrong** and add a note. Reload the page: the answer and the note are still there.
5. Boundary (orchard twins): press **Looks right**, then **Undo my answer**. Next press **Adjust**, move a corner, and press **Done**. Reload: the corrected outline is still there.
6. Open **Feedback & Support** and send "test".
   - **You should see:** "Thank you". The founder's inbox gets it, provided Resend can deliver, and the pilot desk lists it as new.

## 4. Saved work, from somewhere else

1. On another computer, or a tablet, sign in as the participant.
   - **You should see:** the twin in the list with crop, date, photographs and "1 finding reviewed".
2. Open it on a tablet held upright.
   - **You should see:** "Findings and layers" folds the panels away. A selected finding opens as a sheet from the bottom, and the map stays visible.
3. Rename the twin, then delete it.
   - **Deleting should:** say it cannot be undone and that the original photographs are not affected.
   - **Afterwards:** the twin is gone from the list on both devices.
4. Build two twins with the same name on the same day.
   - **You should see:** both in the list. Neither replaces the other.

## 5. What the founder should see

Open `/admin/pilot` (the pilot admin panel). Start with **System health**: every red line is something to fix in Supabase or Resend. Then **Overview**, and the participant's own page under **People**:
- The participant appears with last sign-in, days used, Field Twins, builds finished or failed, typical build time and reviews.
- **Builds** lists your build with its time, photographs used and left out, and camera.
- **What participants said about the findings** shows your Wrong answer next to what Swardus said (for example "corn_weed (confirmed)"), with your note.
- **Feedback** has the test message. Mark it Done.

## 6. Two failure cases on purpose

1. Pick a folder of photographs with no position, such as phone photos or screenshots.
   - **You should see:** "None of these photographs can be used", and Build stays disabled.
2. Start a build and close the tab when the browser asks, choosing Leave. Reopen Field Twins.
   - **You should see:** nothing half-made, because no record exists until the build finishes.
3. Build again and cut the network while it is saving.
   - **You should see:** "The twin was built, but saving it to your account failed", with **Try saving again**.
   - Reconnect and press it. The save should finish.

## Not yet verified anywhere

- A real DJI corn flight with real headers through the whole build. The test twins use UAV3DCrop scenes with written-in headers.
- Building on a tablet. It is expected to be slow or to run out of memory; the Help page recommends a desktop or laptop for building.
- Delivery of invitation emails to participants, which needs a domain verified in Resend.
- Password-reset emails, which need custom SMTP.
