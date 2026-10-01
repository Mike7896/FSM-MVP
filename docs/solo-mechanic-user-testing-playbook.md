# A week in your own garage: ServiceClerk testing playbook

## Your role

Imagine you run **Second Shift Auto — TEST**, a one-person automotive service business. You handle customer calls, estimates, parts, scheduling, repairs, and getting paid. You work from a small, properly equipped garage and use an outside shop for alignments.

Your mission is to manage six fictional customer jobs in ServiceClerk, from the first inquiry through the final follow-up. Your mechanic experience is useful here: tell us when the story, wording, or workflow does not match how you would actually run a job.

This is a test of the app, not a test of you. There is no preferred sequence of clicks. Choose the approach that makes sense to you and say what you expect to happen. Nothing in this exercise requires working on a real vehicle.

## Before you start

The app owner should supply:

- The app address and any signup instructions.
- A designated test account/workspace with access to the features needed below, including any billing accommodation. You should still try the normal signup and business setup journey if that is the agreed starting point.
- An inbox controlled by you or the app owner for receiving test customer messages. Use that address in place of every fictional customer email below when testing delivery; keep the fictional customer names distinct.
- Confirmation of whether customer-facing links, email, and payment recording are ready for testing. Use only controlled recipients and simulated payments. No real purchases, customer charges, or financial-account connections are part of the exercise.

Sign up and set up Second Shift Auto — TEST as a solo business. Record anything confusing before receiving your first customer request. If the app asks for information a small auto business would not have, note the exact wording and how you handled it.

### Shared story rules

- All names, vehicles, findings, prices, and communications are fictional. Vehicle details identify the records; they are not parts-fitment or repair instructions. Treat the inspection findings as supplied story facts and flag anything you would question professionally.
- Use **USD, $100/hour labor, and 0% tax solely for this exercise**. Prices are fixed test inputs, not market estimates. Customer parts prices already include your markup. Add no other fees or discounts. If the app cannot represent these inputs, document the discrepancy.
- Choose an upcoming Monday as **Day 1**. Day 2 is Tuesday, and so on; Day 8 is the following Monday. Use local time. Story time can advance immediately without waiting for actual dates.
- Work occurs at your fictional garage. Use **TEST GARAGE — no real visit** as the location description where possible. Do not invent a real customer's street address to satisfy the app.
- Record the vehicle year, make, model, mileage, and fictional plate with its job. If there is no vehicle field, use the most sensible place and tell us where you expected one. Leave VIN blank; note if the app requires it.
- Read and carry out one story stage at a time. Customer messages in blockquotes are simulated incoming communications. You may play the customer using a preview/share link or ask the app owner to do so. Use only fictional names for test approvals or signatures.
- Try each task unaided first. If stuck for about three minutes, record the screen, your goal, and what you tried. Ask for a hint or use a documented workaround, then continue. A missing feature is a useful finding, not a reason to abandon the remaining story.
- If a step cannot be performed, distinguish **recorded in the app**, **recorded through a workaround**, and **simulated outside the app**. Do not mark an approval, email delivery, or payment integration as successfully tested just because you wrote a note about it.
- If you want to test attachments, make a simple file or photograph of a handwritten card labeled **TEST ONLY — [job ID] — [finding]**. No real customer or employer records are needed.

### Suggested sessions

Start with **B1, T1, and S1**, one from each specialty. Allow roughly 60–90 minutes including signup, and split across sessions if needed. Continue with **B2, T2, and S2** in a second session. These are time budgets, not speed targets. Keep the same business and customer history across sessions.

| Job | Story | Main management challenge |
| --- | --- | --- |
| B1 | Daily-driver front brake replacement | Complete a routine job and retrieve its history |
| B2 | Brake upgrade with an unexpected repair | Compare options, collect a deposit, approve added work |
| T1 | Steering looseness and a delayed part | Separate diagnosis from authorization; reschedule |
| T2 | Steering complaint; repair declined | Bill for diagnosis without recording an unperformed repair |
| S1 | Suspension noise on a returning customer's second car | Keep vehicles separate; coordinate an outside service and partial payments |
| S2 | Rear shocks followed by a return visit | Preserve the original invoice and connect follow-up work |

## B1 — “Can you do my brakes before the weekend?”

### 1. The request arrives

**Customer:** Jamie Rivera · `jamie.rivera@example.invalid`  
**Vehicle:** 2015 Toyota Corolla LE · 118,420 miles · plate TEST-B1  
**Received:** Day 1, 8:15 a.m.

> “The front brakes have been squealing. I use the car for commuting, and I need it back before Friday evening. Could you look at it and tell me what it needs? Please message me before doing any repairs. I can drop it off Tuesday morning.”

Capture the inquiry, vehicle, complaint, deadline, and contact preference. Jamie agrees to a complimentary initial inspection on Day 2 at 8:30 a.m. Reserve 30 minutes and make clear that inspection permission is not repair approval.

### 2. You have inspected it

For the story, the inspection confirms worn front pads and front rotors requiring replacement. The front calipers are serviceable. No rear brake work is recommended at this visit. Record the findings and prepare an itemized quote:

| Work | Quantity × rate | Customer amount |
| --- | --- | ---: |
| Front pad set | 1 × $95 | $95 |
| Front rotors | 2 × $110 | $220 |
| Front brake replacement labor | 1.5 hours × $100 | $150 |
| Shop supplies | 1 × $20 | $20 |
| **Total** | | **$485** |

Explain the front-only scope and expected completion. Let Jamie review the customer-facing version.

### 3. Approval and the work

At 9:15 a.m. Jamie replies:

> “Yes, go ahead with the $485. I can collect it at four.”

Record authorization and reserve Day 2, 10 a.m.–noon for the work. Parts arrive as expected. Your fictional supplier receipt is **$225**, from **Test Parts Supply**, reference **B1-PARTS**. Record this as your expense, separate from what Jamie pays.

Advance the job through the work. Record the completed scope, parts installed, and a short completion note: “Front pads and rotors replaced; post-service checks completed; original noise no longer present during verification.” Include a test attachment if you are trying that feature.

### 4. Collection and closeout

Prepare the final customer invoice. Jamie pays the full **$485 in simulated cash** on Day 2 at collection. Record that payment once and make the receipt or payment confirmation available through the app's supported workflow.

Two story days later, Jamie asks for a copy of the invoice. Find the completed job and provide the same document to the controlled test destination without creating another job or charge.

**You are done when:** the record shows the request, vehicle, approval, appointment, completed front brake work, $225 supplier expense, $485 billed, and $0 balance. You can retrieve the invoice again.

**Tell us:** Did the app make it clear when the work was approved, completed, and paid? Where did you expect to find vehicle history?

## B2 — “Something better than the cheapest brakes”

### 1. The request arrives

**Customer:** Morgan Chen · `morgan.chen@example.invalid`  
**Vehicle:** 2017 Mazda MX-5 Miata Club · 64,200 miles · plate TEST-B2  
**Received:** Day 1, 12:30 p.m.

> “It needs front brakes. I enjoy weekend drives and would like a better street pad, but I don't want a noisy race setup. Can you show me a basic option and an upgrade? I'd like to stay under $850 unless you call me first.”

Record the intended use, budget, and approval condition. Book a complimentary inspection for Day 3, 8:30–9 a.m. The supplied findings are that front pads and rotors need replacement; either fictional package below is suitable for the agreed use. Both retain the existing brake configuration. Do not promise a measurable performance improvement.

### 2. Present a choice

| Item | Standard replacement | Street-pad upgrade |
| --- | ---: | ---: |
| Front pad set | $100 | $160 |
| Front rotors, pair | $240 | $240 |
| Replacement labor, 1.5 hours | $150 | $150 |
| Supplies | $20 | $20 |
| **Package total** | **$510** | **$570** |

Present the two options in the most natural way you can find. They are alternatives, not two packages to add together. Morgan chooses the **$570 upgrade** at 10 a.m. on Day 3 and agrees to a **$200 deposit**. Record the choice and simulated deposit, then book Day 4, 9 a.m.–noon. The original parts expense is **$280**, supplier Test Parts Supply, reference **B2-PARTS**.

### 3. A finding changes the scope

During the fictional work, you find a sticking left-front caliper that was not included in the accepted package. Pause the affected work and record the finding. The added customer cost is:

- Replacement left-front caliper: **$180**.
- Additional labor: **0.5 hours × $100 = $50**.
- Additional fluid/supplies: **$10**.
- **Additional authorization requested: $240. Revised job total: $810.**

The additional supplier expense is **$125**, reference **B2-EXTRA**; no core charge is included in this exercise. Morgan's budget is not blanket permission. Present the change while preserving the original $570 agreement.

At 10:30 a.m. Morgan responds:

> “I approve the extra $240, bringing it to $810. Please keep the upgraded pads. Collecting it at three is fine.”

Record this approval separately from the original acceptance. Update the work slot to end at 1 p.m. and the pickup promise to 3 p.m.

### 4. Finish and reconcile

Record completion and verification of the agreed work. Prepare the final billing so the deposit is credited and the added work appears once. Morgan pays the remaining **$610 by simulated bank transfer** at pickup. Record supplier expenses totaling **$405** separately.

**You are done when:** the selected package, original approval, added-work approval, changed schedule, $810 total charge, $200 deposit, $610 final payment, and $0 balance are understandable from the record. The unselected $510 option has not become a charge.

**Tell us:** Could you see what changed and what was still owed? Would a customer understand the final document without a phone call?

## T1 — “There's play in the steering”

### 1. The request arrives

**Customer:** Taylor Brooks · `taylor.brooks@example.invalid`  
**Vehicle:** 2012 Honda Civic LX · 146,800 miles · plate TEST-T1  
**Received:** Day 2, 1 p.m.

> “The steering feels loose and there is a clunk when I turn slowly. I don't know if it's a tie rod or something else. Can you diagnose it first? I'm free Wednesday afternoon.”

Do not turn the customer's guess into a confirmed diagnosis. Record the symptoms and quote a **$75 steering inspection**, payable even if repairs are declined. Taylor approves it. Book Day 3, 1–1:45 p.m.

### 2. Diagnosis and a second authorization

The supplied inspection finding is excessive play in the right outer tie-rod end. The story's remaining steering checks identify no other repair scope. Record the finding and explain that an outside alignment follows the repair.

Quote **additional work of $290**: right outer tie-rod end $90; replacement labor 0.8 hours × $100 = $80; outside alignment $120. With the previously authorized inspection, the full job is **$365**. The inspection is charged once and is not credited away.

Taylor approves the additional $290 on Day 3 at 2 p.m. Arrange the repair for Day 5, 9–10 a.m., followed by an alignment at **Test Alignment Partner**, 11 a.m.–noon. Reserve time for the handoff and collection as appropriate for one person. Your expenses will be **$50 for the part** and **$90 for the alignment**.

### 3. The part does not arrive

On Day 4, the supplier says the correct part will arrive on Day 8 instead. The vehicle remains at the garage during this fictional delay.

Preserve the approval and repair scope, record the dependency, and move the repair to Day 9, 9–10 a.m. Move the alignment to Day 9, 11 a.m.–noon as well. Taylor accepts the new collection time of Day 9 at 4 p.m. Capture that conversation and verify the old appointments will not still look active.

### 4. The job resumes

On Day 8, record receipt of the correct part. On Day 9, record repair completion and the outside alignment result: “Alignment completed; report received; post-repair verification completed.” A test attachment can stand in for the alignment report.

Issue billing totaling **$365** and record one simulated cash payment for that amount at collection. Preserve the two expense records, totaling **$140**.

**You are done when:** the diagnostic and repair approvals are distinguishable, the delay and revised appointments are visible, the alignment is accounted for, and $365 is paid with no remaining balance.

**Tell us:** Could you identify what the job was waiting on? Did coordinating two appointments require keeping information elsewhere?

## T2 — “Diagnose it, but I might not fix it”

### 1. The request arrives

**Customer:** Casey Patel · `casey.patel@example.invalid`  
**Vehicle:** 2008 Honda Accord EX 2.4L · 189,500 miles · plate TEST-T2  
**Received:** Day 3, 4 p.m.

> “There's a groaning noise while parking and a spot of fluid under the front. It's an older car, so I need to know the price before deciding. Can you inspect it for no more than $100?”

Offer a **$90 diagnostic inspection** with no repair authorization included. Casey accepts. Book Day 4, 2–3 p.m.

### 2. Findings and the repair proposal

The story's diagnostic finding is a leak at the power-steering pressure hose. The recorded recommendation is to replace the hose and reassess after the leak is corrected; no pump replacement is quoted. Record the finding without promising that an unperformed repair has resolved every symptom.

Prepare a separate proposed repair scope: hose **$180**, labor **1.5 hours × $100 = $150**, and fluid/supplies **$30**. The proposed repair is **$360 additional**, or **$450 including the diagnostic visit** if accepted.

### 3. The customer declines

Casey replies:

> “Thanks. I don't want to spend that on this car right now. I'll pay for the inspection and arrange a tow to take it home.”

Record that the **repair proposal is declined**, with the reason and date. No repair parts were ordered and there are no supplier expenses. Keep the completed diagnostic work and its findings accessible. Record that Casey arranged collection by tow; no transport fee belongs on your bill.

### 4. Close the actual work

Invoice **only $90**, record simulated cash payment, and complete the diagnostic engagement. The $360 repair remains unperformed and unbilled. Create a follow-up task for Day 11 to check whether Casey wants to revisit the proposal; no real message needs to be sent.

**You are done when:** the record clearly says “diagnosis completed and paid; repair declined,” and contains $90 billed, $90 paid, and $0 outstanding. It must not imply that the steering repair was completed.

**Tell us:** Could you finish the work you actually did while preserving the declined recommendation? Did the app try to turn the declined scope into an invoice or an unfinished obligation?

## S1 — “Same customer, different car”

### 1. Jamie comes back with another vehicle

**Customer:** Jamie Rivera, the existing B1 customer  
**Vehicle:** 2014 Toyota RAV4 LE AWD · 132,600 miles · plate TEST-S1  
**Received:** Day 5, 9 a.m.

> “You did the Corolla brakes earlier this week. Our RAV4 clunks over bumps, and the front feels bouncy. Could you look at that next? I need it for a trip next Thursday.”

Use Jamie's existing customer record and create a distinct job for the RAV4. The deadline is Day 11 at 5 p.m. Arrange a complimentary inspection for Day 8, 8:30–9 a.m. Make sure you can still distinguish the Corolla's brake history from this vehicle's complaint.

### 2. Inspection, quote, and dependencies

For the story, both front strut assemblies and both front stabilizer end links are recommended for replacement. There is no additional rear suspension work in this scope.

| Work | Quantity × rate | Customer amount |
| --- | --- | ---: |
| Complete front strut assemblies | 2 × $240 | $480 |
| Front stabilizer end links | 2 × $45 | $90 |
| Replacement labor | 2.2 hours × $100 | $220 |
| Outside alignment | 1 × $120 | $120 |
| Supplies | 1 × $15 | $15 |
| **Total** | | **$925** |

Jamie approves $925 on Day 8 at 10 a.m. and pays a **$300 simulated deposit**. Book your work for Day 10, 9 a.m.–noon, and Test Alignment Partner for 1–2 p.m. Leave room for the handoff. Confirm parts are due on Day 9 and assign yourself a reminder to check their arrival.

Record planned supplier costs: parts **$390**, supplies **$10**, and alignment **$90**. When the story advances, record the actual receipts at those amounts. Do not add these expenses to the already agreed customer total.

### 3. Work is finished; payment is not

Parts arrive and all approved work and verification finish on Day 10. Preserve the alignment report or a clearly labeled test substitute. Tell Jamie the vehicle is ready and present final billing with the deposit accounted for.

Jamie pays **$400 in simulated cash** at collection and, by prior agreement, will transfer the remaining **$225 on Day 12**. Record the $400 now. Leave the repair completed while showing the unpaid balance and its agreed due date. Set yourself a collection follow-up.

### 4. The balance arrives

Advance to Day 12. Jamie's **$225 simulated bank transfer** arrives. Record it against the existing obligation, confirm the zero balance, and resolve the collection follow-up. Retrieve both of Jamie's jobs to verify that this payment did not affect the Corolla invoice.

**You are done when:** Jamie has one customer identity with two distinct vehicle jobs; this job shows $925 billed, payments of $300 + $400 + $225, $490 of expenses, and $0 due. Completion and full payment happened at different times.

**Tell us:** Was the distinction between finished work and unpaid money clear? Could you find the right vehicle without opening every document?

## S2 — “The repair is done, but the customer calls again”

### 1. The original request

**Customer:** Avery Wilson · `avery.wilson@example.invalid`  
**Vehicle:** 2016 Ford F-150 XLT 4WD · 104,300 miles · plate TEST-S2  
**Received:** Day 8, 11 a.m.

> “The rear keeps bouncing after bumps. I want it back to normal for everyday use. No lift kit or other modifications. Can you inspect it and quote the repair?”

Book a complimentary inspection for Day 9, 2–2:30 p.m. The supplied findings support replacement of both rear shocks. Quote **two rear shocks at $140 each**, **labor of 1.2 hours × $100 = $120**, and **$10 supplies**, totaling **$410**. No alignment is included in this fictional rear-shock scope.

### 2. Approve, perform, and bill

Avery approves **$410** on Day 9 at 3 p.m. Schedule Day 11, 9–11 a.m. Record parts and supplies expense of **$185**, supplier Test Parts Supply, reference **S2-PARTS**. Record the completed replacement and post-service verification. Invoice $410, record the full simulated cash payment, and close the original work.

### 3. The return call

On Day 15, Avery says:

> “The bouncing is better, but I hear a rattle from the back on rough roads. Could it be related to the shocks you just replaced?”

Find the original job before making a new record. Capture Avery's description as a reported concern, without assigning a cause. Offer a **no-charge follow-up inspection** for Day 16, 9–9:30 a.m. Make that appointment and concern traceable to the original work, using whatever relationship or reference the app supports. Preserve the paid invoice and original completion notes.

### 4. Resolve the concern

The story's follow-up finding is that the replacement shocks and their installation check out, and a loose item in the bed storage box caused the rattle. With Avery's permission, the item is secured; the rattle is no longer present during verification. No parts are used, and there is **no additional charge**.

Record the finding, the 0.5-hour no-charge visit, the outcome, and the communication to Avery. Close the follow-up without recording another $410 payment or changing the original invoice. If the app requires a separate job or a zero-dollar document, note that behavior and whether it fits your expectations.

**You are done when:** the original $410 job remains completed and paid, the later concern and resolution can be found from its history, and the customer owes $0 for the follow-up.

**Tell us:** Where would you naturally look for a comeback? Could you tell what was reported, what you found, and why there was no further charge?

## After every scenario: a two-minute debrief

Copy this block into your notes for each job. Screenshots are optional; include the screen name and exact error text when useful.

```text
Scenario ID:
Device/browser:
Approximate time spent:
Outcome: completed unaided / completed with help / partial / blocked
Ease: 1 very difficult — 7 very easy

What I was trying to accomplish:
Where I expected to do it:
What I tried and what actually happened:
Anything I could only do in notes or outside the app:
Anything I could not finish:
One thing that worked well:
One thing I would change first:
Any mechanical/story detail that did not feel realistic:
```

After saving and reopening the job, check its customer, vehicle, approved scope, appointments, documents, and money. Report any difference from what you entered. For customer-facing documents, also check whether the scope, price, deposit, and amount due would make sense to someone who has not seen your internal notes.

## Final challenge: run tomorrow's business

Without consulting the story text, use the records you created to answer:

1. What work is coming up, and is any appointment still at its superseded time?
2. Which vehicle belonged to each job, and which customer brought in two vehicles?
3. Which repair was declined, and where is the original finding?
4. Who approved the added brake work, for how much, and when?
5. What did Jamie owe after the RAV4 was collected but before the last transfer?
6. What happened on Avery's return visit, and did it change the original invoice?
7. Which information did you have to keep outside the app to answer these questions?

Then tell the app owner: **Would you trust this app to tell you what to do next and what customers owe? What would have to change before you would use it for a real solo mechanic business?**

## App owner notes and reconciliation key

Let the participant attempt tasks before pointing out controls. Record first attempts separately from attempts after a hint. A successful workaround is valuable evidence, but does not establish that the intended feature worked. Distinguish confusing navigation, missing capability, incorrect saved data, setup/delivery failures, and a mismatch with how mechanics work.

The scenarios are outcomes to attempt, not a guarantee that every workflow is supported. In particular, observe vehicle tracking, alternative packages, delayed parts, outside-service coordination, declined repairs, and linked return visits. Do not pre-teach these workflows merely to get every box checked.

| Scenario | Final customer charge | Simulated payments | Final balance | Supplier expenses |
| --- | ---: | --- | ---: | ---: |
| B1 | $485 | $485 | $0 | $225 |
| B2 | $810 | $200 + $610 | $0 | $405 |
| T1 | $365 | $365 | $0 | $140 |
| T2 | $90 | $90 | $0 | $0 |
| S1 | $925 | $300 + $400 + $225 | $0 | $490 |
| S2 | $410 | $410; follow-up $0 | $0 | $185 |
| **Total** | **$3,085** | **$3,085** | **$0** | **$1,445** |

These are job-level charge totals regardless of how the app splits deposit and final documents. Deposits are part of the total, not additional revenue. Expense totals are recorded purchases only; they do not calculate profit after owner labor, overhead, or other costs.

At the end, the expected history contains **five customers, six original jobs, and one no-charge follow-up**, which may be a linked visit or an additional job depending on the app's model. Keep the participant's chosen representation in the findings. One domain-experienced friend's session can reveal useful problems; it does not establish that all prospective customers will behave the same way.
