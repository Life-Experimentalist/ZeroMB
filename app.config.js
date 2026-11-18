// Reads app.json and lets an EAS profile choose the CPU architectures via ZEROMB_ARCHS (comma separated).
const base = require('./app.json');

module.exports = () => {
  const archs = (process.env.ZEROMB_ARCHS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!archs.length) return base;
  const expo = JSON.parse(JSON.stringify(base.expo));
  expo.plugins = expo.plugins.map((p) =>
    Array.isArray(p) && p[0] === 'expo-build-properties'
      ? [p[0], { ...p[1], android: { ...p[1].android, buildArchs: archs } }]
      : p,
  );
  return { expo };
};
