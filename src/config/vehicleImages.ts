import type { VehicleCategory } from '../types/vehicle';

import popularImg from '../assets/images/vehicle_popular_hatch_1795631407230.jpg';
import sedanImg from '../assets/images/vehicle_executive_sedan_1795631406957.jpg';
import suvImg from '../assets/images/vehicle_urban_suv_1795631408176.jpg';
import esportivoImg from '../assets/images/vehicle_sport_coupe_1795631409401.jpg';
import luxoImg from '../assets/images/vehicle_luxury_saloon_1795631410368.jpg';
import picapeImg from '../assets/images/vehicle_heavy_pickup_1795631411340.jpg';
import motoImg from '../assets/images/vehicle_street_moto_1795631412286.jpg';
import caminhaoImg from '../assets/images/vehicle_cargo_truck_1795631413389.jpg';

export const VEHICLE_CATEGORY_IMAGES: Record<VehicleCategory, string> = {
  popular: popularImg,
  sedan: sedanImg,
  suv: suvImg,
  esportivo: esportivoImg,
  luxo: luxoImg,
  picape: picapeImg,
  moto: motoImg,
  caminhao: caminhaoImg,
};

export function getVehicleCategoryImage(category: VehicleCategory | string): string {
  if (category in VEHICLE_CATEGORY_IMAGES) {
    return VEHICLE_CATEGORY_IMAGES[category as VehicleCategory];
  }
  return sedanImg;
}
