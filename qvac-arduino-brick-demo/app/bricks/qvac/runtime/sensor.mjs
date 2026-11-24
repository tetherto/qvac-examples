export function sensorFacts(temperature, humidity, source = 'simulated') {
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < -50 || temperature > 100) {
    throw new Error('Use a temperature between -50 and 100 C.');
  }
  if (typeof humidity !== 'number' || !Number.isFinite(humidity) || humidity < 0 || humidity > 100) {
    throw new Error('Use humidity between 0 and 100 percent.');
  }
  if (!['live', 'simulated'].includes(source)) throw new Error('source must be live or simulated.');
  const temperatureStatus = temperature < 22 ? 'below target' : temperature > 28 ? 'above target' : 'within target';
  const humidityStatus = humidity < 40 ? 'below target' : humidity > 70 ? 'above target' : 'within target';
  return { temperature, humidity, temperatureStatus, humidityStatus, source };
}

export function sensorPrompt(reading) {
  const context = reading.source === 'live'
    ? 'Greenhouse readings measured by a live DHT11 sensor on Arduino UNO Q pin D2.'
    : 'Classroom greenhouse demo with simulated sensor readings.';
  return `${context}\nKnown fact 1: temperature is ${reading.temperature} C and is ${reading.temperatureStatus}.\nKnown fact 2: humidity is ${reading.humidity}% and is ${reading.humidityStatus}.\nDemo targets: temperature 22 to 28 C, humidity 40 to 70%.\nIn explanation, name the measured temperature and humidity and the status of EACH reading. In next_step, suggest a specific action a person could take. If both readings are within target, keep monitoring.`;
}
