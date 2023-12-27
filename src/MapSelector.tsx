import { Link } from 'react-router-dom';

import "./MapSelector.css";

import customs from "./maps/customs.png";
import interchange from "./maps/interchange.png";
import woods from "./maps/woods.png";
import labs from "./maps/labs.jpg";
import reserve from "./maps/reserve.png";
import shoreline from "./maps/shoreline.png";
import lighthouse from "./maps/lighthouse.png";
import factory from "./maps/factory.jpg";
import streets from "./maps/streets.png";
import groundZero from "./maps/ground-zero.webp";

import customsThumbnail from "./maps/customs-thumbnail.png";
import interchangeThumbnail from "./maps/interchange-thumbnail.png";
import woodsThumbnail from "./maps/woods-thumbnail.png";
import labsThumbnail from "./maps/labs-thumbnail.png";
import reserveThumbnail from "./maps/reserve-thumbnail.png";
import shorelineThumbnail from "./maps/shoreline-thumbnail.png";
import lighthouseThumbnail from "./maps/lighthouse-thumbnail.png";
import factoryThumbnail from "./maps/factory-thumbnail.png";
import streetsThumbnail from "./maps/streets-thumbnail.png";
import groundZeroThumbnail from "./maps/ground-zero.webp";

export const maps: Record<string, string> = {customs, interchange, woods, labs, reserve, shoreline, factory, lighthouse, streets, groundZero};
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
};

function MapSelector() {
  return (
    <div className="MapSelector">
      <header className="App-header">
        <Link className="App-header-title" to="/">Tarkov Debrief</Link>
      </header>
      <section className="MapList">
        {Object.entries(maps).map(([key, value]) =>
          <Link key={key} className="MapList-Card" to={`/app/${key}`}>
            <img width={380} src={thumbnails[key]} alt="key"/>
            <p>{key}</p>
          </Link>
        )}
      </section>
    </div>
  )
}

export default MapSelector;