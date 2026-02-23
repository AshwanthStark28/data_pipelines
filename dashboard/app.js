const appointments = [
  { time: "08:30", patient: "Mia Rodriguez", doctor: "Dr. Patel", department: "Cardiology", status: "waiting", waitMins: 14 },
  { time: "09:00", patient: "Logan Hughes", doctor: "Dr. Evans", department: "Pulmonology", status: "in-consultation", waitMins: 6 },
  { time: "09:20", patient: "Ava Lewis", doctor: "Dr. Khan", department: "Neurology", status: "completed", waitMins: 3 },
  { time: "10:00", patient: "Noah Bennett", doctor: "Dr. Singh", department: "Orthopedics", status: "delayed", waitMins: 28 },
  { time: "10:30", patient: "Olivia Nguyen", doctor: "Dr. Davis", department: "General Medicine", status: "waiting", waitMins: 12 },
  { time: "11:00", patient: "Ethan Cooper", doctor: "Dr. Shah", department: "Endocrinology", status: "completed", waitMins: 5 }
];

const patients = [
  { name: "Mia Rodriguez", age: 67, condition: "Post-op recovery", room: "A-204", risk: "moderate", checkIn: "10:15 AM" },
  { name: "Noah Bennett", age: 52, condition: "Hypertension management", room: "C-117", risk: "high", checkIn: "10:45 AM" },
  { name: "Sophia Wright", age: 41, condition: "Diabetes follow-up", room: "B-091", risk: "low", checkIn: "11:10 AM" },
  { name: "James Foster", age: 74, condition: "COPD observation", room: "A-309", risk: "high", checkIn: "11:25 AM" },
  { name: "Ava Lewis", age: 35, condition: "Migraine treatment", room: "D-022", risk: "low", checkIn: "12:00 PM" }
];

const alerts = [
  { title: "ICU bed 3 requires review", detail: "High blood pressure trend above threshold for 40 minutes.", severity: "high" },
  { title: "Medication refill pending", detail: "Ward C has 2 pending refill requests older than 25 minutes.", severity: "medium" },
  { title: "Lab report delayed", detail: "Three CBC reports have not been posted to the EHR queue.", severity: "medium" }
];

const adherence = [
  { ward: "Cardiology", score: 92 },
  { ward: "Neurology", score: 88 },
  { ward: "Orthopedics", score: 85 },
  { ward: "General Medicine", score: 95 }
];

const weeklyAdmissions = [
  { day: "Mon", count: 22 },
  { day: "Tue", count: 18 },
  { day: "Wed", count: 26 },
  { day: "Thu", count: 21 },
  { day: "Fri", count: 24 },
  { day: "Sat", count: 15 },
  { day: "Sun", count: 12 }
];

function averageWait(data) {
  if (!data.length) {
    return 0;
  }
  const total = data.reduce((sum, item) => sum + item.waitMins, 0);
  return Math.round(total / data.length);
}

function formatStatus(status) {
  return status.replace("-", " ");
}

function renderKPIs() {
  const avgWait = averageWait(appointments);
  const occupancy = 78;

  document.getElementById("kpiPatients").textContent = String(patients.length);
  document.getElementById("kpiAppointments").textContent = String(appointments.length);
  document.getElementById("kpiWait").textContent = `${avgWait} min`;
  document.getElementById("kpiOccupancy").textContent = `${occupancy}%`;
}

function appointmentRow(item) {
  return `
    <tr>
      <td>${item.time}</td>
      <td>${item.patient}</td>
      <td>${item.doctor}</td>
      <td>${item.department}</td>
      <td><span class="status-pill ${item.status}">${formatStatus(item.status)}</span></td>
    </tr>
  `;
}

function renderAppointments(status = "all") {
  const rows = appointments
    .filter((item) => status === "all" ? true : item.status === status)
    .map(appointmentRow)
    .join("");

  const tableBody = document.getElementById("appointmentsBody");
  tableBody.innerHTML = rows || `
    <tr>
      <td colspan="5">
        <div class="empty-state">No appointments for this status.</div>
      </td>
    </tr>
  `;
}

function alertRow(item) {
  const className = item.severity === "high" ? "alert-item high" : "alert-item";
  return `
    <li class="${className}">
      <p>${item.title}</p>
      <p>${item.detail}</p>
    </li>
  `;
}

function renderAlerts() {
  document.getElementById("alertsList").innerHTML = alerts.map(alertRow).join("");
}

function patientCard(item) {
  return `
    <article class="patient-row">
      <div>
        <p class="patient-name">${item.name}</p>
        <p class="patient-detail">Age ${item.age} - ${item.condition}</p>
      </div>
      <p class="patient-detail">Room ${item.room}</p>
      <p class="patient-detail">Next check: ${item.checkIn}</p>
      <span class="risk-badge ${item.risk}">${item.risk}</span>
    </article>
  `;
}

function renderPatients(query = "") {
  const normalized = query.trim().toLowerCase();
  const filtered = patients.filter((item) => {
    if (!normalized) {
      return true;
    }

    return [
      item.name,
      item.condition,
      item.room
    ].some((text) => text.toLowerCase().includes(normalized));
  });

  document.getElementById("patientsList").innerHTML = filtered.length
    ? filtered.map(patientCard).join("")
    : `<div class="empty-state">No patients match your search.</div>`;
}

function adherenceRow(item) {
  return `
    <div class="adherence-item">
      <p><span>${item.ward}</span><span>${item.score}%</span></p>
      <div class="progress"><span style="width:${item.score}%"></span></div>
    </div>
  `;
}

function renderAdherence() {
  document.getElementById("adherenceList").innerHTML = adherence.map(adherenceRow).join("");
}

function renderAdmissions() {
  const highest = Math.max(...weeklyAdmissions.map((item) => item.count));
  const bars = weeklyAdmissions.map((item) => {
    const height = Math.round((item.count / highest) * 100);
    return `
      <div class="bar" title="${item.day}: ${item.count}">
        <span style="height:${height}%"></span>
      </div>
    `;
  });

  document.getElementById("admissionBars").innerHTML = bars.join("");
}

function updateTimestamps() {
  const now = new Date();
  document.getElementById("todayDate").textContent = now.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  document.getElementById("lastUpdated").textContent = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function initEvents() {
  document.getElementById("appointmentFilter").addEventListener("change", (event) => {
    renderAppointments(event.target.value);
  });
  document.getElementById("patientSearch").addEventListener("input", (event) => {
    renderPatients(event.target.value);
  });
}

function init() {
  renderKPIs();
  renderAppointments();
  renderAlerts();
  renderPatients();
  renderAdherence();
  renderAdmissions();
  updateTimestamps();
  initEvents();
}

init();
