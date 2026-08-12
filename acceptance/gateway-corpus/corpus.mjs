// The twelve Gateway MCP prompts — VERBATIM acceptance corpus (owner, 2026-08-10).
// "Treat these prompts as immutable acceptance tests. Do not rewrite them. Do not
// simplify them. Investigate why they succeed or fail."
// body = the goal text fed to Composer, exactly as delivered. title/tool = metadata only.

export const CORPUS = [
  {
    n: 1,
    title: "Service Catalog Explorer",
    tool: "get_service_catalog",
    body: `A service catalog explorer for configuring an IP services request.
Start with a prominent Service Type selector showing the available
services by human-readable name. After a service is selected, show a
dependent Workflow selector populated with the workflows available for
that service.
Below that, organize the remaining available configuration options
such as jurisdiction, source locale, country, and translation quality
into a clean form. Disabled options should remain visible but clearly
unavailable. Show descriptions or useful metadata as contextual help
when available.
As selections are made, show a compact summary of the current service
configuration so the user can understand exactly what they have
chosen.
The interface should feel like the beginning of an estimate or project
creation workflow rather than a generic settings form.`,
  },
  {
    n: 2,
    title: "Filing Directory Browser",
    tool: "get_filing_directory",
    body: `A searchable filing directory browser for selecting people,
organizations, agents, applicants, case managers, and other
filing-related entities.
Provide a directory type selector followed by a searchable list or
combobox of matching entries.
Each result should emphasize the entity's name, with its directory
kind, relevant contact information, and location or address shown as
secondary information when available.
Selecting an entry should open or reveal a compact detail view so the
user can confidently verify the entity before using it in a filing,
estimate, or project workflow.
Support loading, no-results, unavailable-entry, and selected states.
The interface should feel like selecting a trusted business entity
from an enterprise legal-services directory, not choosing a value from
a basic dropdown.`,
  },
  {
    n: 3,
    title: "Estimate Workspace",
    tool: "get_estimate",
    body: `An estimate detail workspace for an IP services estimate.
At the top, show the estimate reference or identifier, current status,
and the most important service context.
Below it, organize the estimate into clear sections for service
details, jurisdictions or languages when available, pricing and
currency, important dates, and other meaningful estimate information
returned by the service.
Warnings should be visible without overwhelming the estimate.
If documents or estimate-related links are available, show them in a
separate documents area.
Provide a clear place for the next available action, especially when
the estimate can proceed into project creation.
The interface should make an estimate easy to review with a client or
colleague during a live demonstration without exposing raw API JSON.`,
  },
  {
    n: 4,
    title: "Create Estimate",
    tool: "create_estimate",
    body: `A guided Create Estimate interface for an IP services workflow.
Begin with service configuration: Service Type, Workflow, jurisdiction
and other relevant service options supplied by the service catalog.
Organize the remaining estimate inputs into logical sections rather
than presenting one long technical form.
Before submission, show a review panel summarizing exactly what will
be sent: selected service, workflow, jurisdiction, client/reference
information, and other important request details.
Creating the estimate requires explicit confirmation. Show a calm
confirmation step explaining that a new Test 1 estimate will be
created, with Cancel and Confirm and Create actions. Confirmation must
never be preselected.
After creation succeeds, transition into the resulting estimate detail
view and clearly indicate that the newly created estimate was
successfully retrieved from Gateway.
The experience should tell one continuous story:
Configure service → enter estimate details → review → confirm → create
→ view the resulting estimate.`,
  },
  {
    n: 5,
    title: "Convert Estimate to Project",
    tool: "convert_estimate_to_project",
    body: `A Convert Estimate to Project workflow.
Start with a summary of the selected estimate so the user can verify
which estimate will be converted.
Show the project information required for conversion in a focused
form, including relevant deadline, recipient, reference,
application/publication, or other fields when they are part of the
supplied request data.
Clearly separate information inherited from the estimate from
information the user is supplying for the new project.
Before conversion, show a review step explaining that this action will
create a project from the estimate.
Require explicit confirmation with Cancel and Confirm Conversion actions.
After conversion succeeds, transition directly to the resulting
Project detail interface. Make the new project identifier and status
prominent and show that the project was successfully read back from
Gateway.
The workflow should visually communicate:
Estimate → conversion details → review → confirmation → project
created → project verified.`,
  },
  {
    n: 6,
    title: "Direct Project Creation",
    tool: "create_project",
    body: `A guided Create Project interface for creating an IP services project
directly without first creating an estimate.
Start with service and workflow configuration, followed by the
project-specific information required by the request.
Organize the form into clear sections such as Service Configuration,
Project Details, Client or Reference Information, Jurisdiction or
Language Details, and Timing or Delivery information when those values
are available.
Before submission, show a concise review of the project that will be created.
Require an explicit confirmation step. Explain that this will create a
new Test 1 project and that the operation should not be submitted
repeatedly if its result is uncertain.
After successful creation, transition to the resulting Project detail
view and prominently show the new project identity and status.
The interface should tell a continuous story:
Configure → enter project details → review → confirm → create →
retrieve and inspect the project.`,
  },
  {
    n: 7,
    title: "Project Workspace",
    tool: "get_project",
    body: `A project detail workspace for an IP services project.
Create a strong project header showing the project identifier or
reference, current state, service/workflow context, and the most
important client or project information.
Below the header, organize information into clear sections:
- Project overview
- Service and jurisdiction details
- Important dates
- Line items
- Documents or artifacts when available
- Additional details
Make Project Line Items a major part of the interface. Present them as
a clean table or structured list showing the canonical service, target
language, jurisdiction, status, quantity, or other confirmed line-item
information supplied by the project.
Do not make raw extension data part of the primary interface. If
additional extension information is useful, place it behind an
Additional Details disclosure.
Warnings should be noticeable but secondary to the project itself.
If a next action is available, show it as a contextual project action.
The interface should feel like the main workspace someone would use to
understand the state and contents of a real IP services project.`,
  },
  {
    n: 8,
    title: "Mutation Confirmation",
    tool: null,
    body: `A reusable confirmation interface for an MCP operation that will
create, convert, update, or otherwise change Gateway data.
Show a concise human-readable summary of what is about to happen and
the important resource or request details affected by the operation.
For normal creation operations, use a calm review-and-confirm
treatment rather than a dangerous-action warning.
For destructive or high-impact operations, use stronger warning
treatment when the tool indicates that it is destructive or
non-idempotent.
Clearly distinguish the two choices:
Cancel
Confirm and Continue
Confirmation must never be selected automatically.
If the operation should not be blindly retried, communicate that
clearly but concisely.
The user should be able to understand what they are approving without
seeing raw MCP arguments or API payloads.`,
  },
  {
    n: 9,
    title: "Operation Progress",
    tool: null,
    body: `An operation progress interface for a long-running Gateway task.
Show the resource being processed, current operation state, and
elapsed time since the operation was accepted.
If a recommended polling interval is available, communicate when the
next status check will occur.
If expected webhook events are available, show them as secondary information.
Do not invent a completion percentage when the service has not
supplied one. Use an indeterminate progress treatment instead.
Clearly distinguish:
Processing
Processing files
Waiting
Timed out
Failed
Completed
A timeout should look different from a failed business operation.
If the service supplies a recommended next action, show it prominently
below the progress state.
The interface should feel like tracking a real business operation, not
merely displaying a loading spinner.`,
  },
  {
    n: 10,
    title: "File / Artifact Card",
    tool: "download_file (future)",
    body: `A reusable document and artifact card for files associated with
estimates, projects, orders, or other Gateway resources.
Make the filename the primary element.
Show available metadata such as document type, media type, and file
size beneath it. Do not show empty metadata labels when those values
are unavailable.
Provide a clear Download or Open action when the artifact is retrievable.
Support a compact document-list layout where several artifact cards
appear together.
Include states for:
Available for download
Metadata available but file unavailable
Downloading
Download failed
The design should work for PDFs, Word documents, spreadsheets, and
unknown file types without assuming that MIME type or file extension
is always supplied.
The interface should look like a professional business-document
attachment, not a consumer cloud-storage tile.`,
  },
  {
    n: 11,
    title: "Gateway Error / Recovery State",
    tool: null,
    body: `A reusable error and recovery interface for an MCP Gateway tool.
Present the human-readable error message first, followed by only the
technical information useful for recovery.
Support visually distinct states for:
Validation problem
Confirmation required
Resource not found
Gateway or dependency unavailable
Timeout
Authorization or configuration problem
General operation failure
When field-level issues are available, show them beside or beneath the
affected fields.
When the error is retryable, provide a Retry action. If a retry delay
is supplied, communicate it.
When another MCP tool is suggested as the recovery action, present
that as a clear next step.
Make correlation information available as secondary troubleshooting detail.
Never present raw stack traces, bearer tokens, credentials, or
sensitive upstream responses.
The interface should help the user recover rather than simply announce
that something failed.`,
  },
  {
    n: 12,
    title: "The full demo composition",
    tool: null,
    body: `An end-to-end Gateway MCP demo workspace showing the lifecycle of an
IP services request.
The experience should guide the user through:
1. Explore the available service catalog.
2. Select a Service Type and dependent Workflow.
3. Configure and create an estimate.
4. Explicitly review and confirm creation.
5. Display the newly created estimate after it is read back from Gateway.
6. Convert that estimate into a project.
7. Explicitly review and confirm the conversion.
8. Display the newly created project after it is read back from Gateway.
9. Show the project's canonical line items and important project details.
10. Surface any relevant next action.
Use a clear workflow or step-based structure so the viewer always
understands where they are in the lifecycle:
Service → Estimate → Project
Preserve the resulting estimate and project context as the user moves
through the workflow rather than making each tool invocation feel like
an unrelated screen.
Read operations should feel immediate.
Write operations should always have an explicit review and
confirmation boundary.
Successful writes should visually transition into the canonical
resource returned by the subsequent read-back so the viewer can see
that the operation created a real Gateway resource.
Warnings and errors should appear contextually without destroying the
current workflow state.
This is a professional IP-services workflow demonstration, not an API
testing console. Do not expose raw MCP JSON as the primary experience.`,
  },
];
