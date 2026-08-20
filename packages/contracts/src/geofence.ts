export type Coordinates = { latitude: number; longitude: number };

const EARTH_RADIUS_METERS = 6_371_000;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceInMeters(a: Coordinates, b: Coordinates): number {
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const startLatitude = radians(a.latitude);
  const endLatitude = radians(b.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function isInsideGeofence(
  point: Coordinates,
  center: Coordinates,
  radiusMeters: number,
): boolean {
  return distanceInMeters(point, center) <= radiusMeters;
}
