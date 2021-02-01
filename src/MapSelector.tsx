import React from 'react';
import { Link } from 'react-router-dom';

import "./MapSelector.css";

import customs from "./maps/customs.png";
import interchange from "./maps/interchange.png";
import woods from "./maps/woods.png";
import labs from "./maps/labs.jpg";
import reserve from "./maps/reserve.png";
import shoreline from "./maps/shoreline.png";
import factory from "./maps/factory.jpg";

import customsThumbnail from "./maps/customs-thumbnail.png";
import interchangeThumbnail from "./maps/interchange-thumbnail.png";
import woodsThumbnail from "./maps/woods-thumbnail.png";
import labsThumbnail from "./maps/labs-thumbnail.png";
import reserveThumbnail from "./maps/reserve-thumbnail.png";
import shorelineThumbnail from "./maps/shoreline-thumbnail.png";
import factoryThumbnail from "./maps/factory-thumbnail.png";

export const maps: Record<string, string> = {customs, interchange, woods, labs, reserve, shoreline, factory};
export const thumbnails: Record<string, string> = {
  customs: customsThumbnail,
  interchange: interchangeThumbnail,
  woods: woodsThumbnail,
  labs: labsThumbnail,
  reserve: reserveThumbnail,
  shoreline: shorelineThumbnail,
  factory: factoryThumbnail,
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
            <img src={thumbnails[key]} alt="key"/>
            <p>{key}</p>
          </Link>
        )}
      </section>
    </div>
  )
}

export default MapSelector;