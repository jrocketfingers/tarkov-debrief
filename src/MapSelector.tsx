import { Link } from 'wouter';

import "./MapSelector.css";

import customs from "./maps/customs.webp";
import interchange from "./maps/interchange.webp";
import woods from "./maps/woods.webp";
import labs from "./maps/labs.webp";
import reserve from "./maps/reserve.webp";
import shoreline from "./maps/shoreline.webp";
import lighthouse from "./maps/lighthouse.webp";
import factory from "./maps/factory.webp";
import streets from "./maps/streets.webp";
import groundZero from "./maps/ground-zero.webp";
import icebreaker from "./maps/icebreaker.webp";

import customsThumbnail from "./maps/customs-thumbnail.webp";
import interchangeThumbnail from "./maps/interchange-thumbnail.webp";
import woodsThumbnail from "./maps/woods-thumbnail.webp";
import labsThumbnail from "./maps/labs-thumbnail.webp";
import reserveThumbnail from "./maps/reserve-thumbnail.webp";
import shorelineThumbnail from "./maps/shoreline-thumbnail.webp";
import lighthouseThumbnail from "./maps/lighthouse-thumbnail.webp";
import factoryThumbnail from "./maps/factory-thumbnail.webp";
import streetsThumbnail from "./maps/streets-thumbnail.webp";
import groundZeroThumbnail from "./maps/ground-zero-thumbnail.webp";
import icebreakerThumbnail from "./maps/icebreaker-thumbnail.webp";

export const maps: Record<string, string> = {customs, interchange, woods, labs, reserve, shoreline, factory, lighthouse, streets, groundZero, icebreaker};
export const thumbnails: Record<string, string> = {
  customs: customsThumbnail,
  interchange: interchangeThumbnail,
  woods: woodsThumbnail,
  labs: labsThumbnail,
  reserve: reserveThumbnail,
  shoreline: shorelineThumbnail,
  factory: factoryThumbnail,
  lighthouse: lighthouseThumbnail,
  streets: streetsThumbnail,
  groundZero: groundZeroThumbnail,
  icebreaker: icebreakerThumbnail,
};

function MapSelector() {
  return (
    <div className="MapSelector">
      <header className="App-header">
        <Link className="App-header-title" to="/">Tarkov Debrief</Link>
      </header>
      <section className="MapList">
        {Object.keys(maps).map((key) =>
          <Link key={key} className="MapList-Card" to={`/app/${key}`}>
            <img width={380} src={thumbnails[key]} alt={key}/>
            <p>{key}</p>
          </Link>
        )}
      </section>
    </div>
  )
}

export default MapSelector;
