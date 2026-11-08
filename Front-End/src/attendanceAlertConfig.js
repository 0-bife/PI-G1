export const ATTENDANCE_ALERT_MINUTES_KEY = 'inablink.attendanceAlertMinutes';
export const DEFAULT_ATTENDANCE_ALERT_MINUTES = 30;

export function getAttendanceAlertMinutes() {
  const storedValue = Number(window.localStorage.getItem(ATTENDANCE_ALERT_MINUTES_KEY));
  return Number.isInteger(storedValue) && storedValue >= 1 ? storedValue : DEFAULT_ATTENDANCE_ALERT_MINUTES;
}

export function saveAttendanceAlertMinutes(minutes) {
  window.localStorage.setItem(ATTENDANCE_ALERT_MINUTES_KEY, String(minutes));
}
