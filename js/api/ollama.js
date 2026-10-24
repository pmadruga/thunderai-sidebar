/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */


import { redactApiError } from './api-utils.js';
import { secureFetch } from '../endpoint-policy.js';

export class Ollama {
    host = '';
    model = '';
    stream = false;
    num_ctx = 0;
    temperature = '';
    think = false;
    format_json = false;

    constructor({
      host = '',
      model = '',
      stream = false,
      num_ctx = 0,
      temperature = '',
      think = false,
      format_json = false,
    } = {}) {
      this.host = (host || '').trim().replace(/\/+$/, "");
      this.model = model;
      this.stream = stream;
      this.num_ctx = num_ctx;
      this.temperature = temperature;
      this.think = think;
      this.format_json = format_json;
    }

    fetchModels = async (signal) => {
      try{
        const response = await secureFetch(this.host + "/api/tags", {
            method: "GET",
          signal,
            headers: {
                "Content-Type": "application/json"
            },
        });

        if (!response.ok) {
            const errorDetail = await response.text();
            let err_msg = "[ThunderAI] Ollama API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail;
            console.error("[ThunderAI] Provider rejected the models request");
            let output = {};
            output.ok = false;
            output.error = redactApiError(errorDetail, this.apiKey);
            return output;
        }

        let output = {};
        output.ok = true;
        let output_response = await response.json();
        output.response = output_response;

        //console.log(">>>>>>>>>> output_response: " + JSON.stringify(output_response));

        return output;
      }catch (error) {
        if (error?.name === 'AbortError') throw error;
        console.error("[ThunderAI] Ollama API request failed: ");
        let output = {};
        output.is_exception = true;
        output.ok = false;
        output.error = "Ollama API request failed: " + redactApiError(error, this.apiKey);
        return output;
      }
    }

    
    fetchResponse = async (messages, { signal } = {}) => {
      try {
        const tempFloat = parseFloat(this.temperature);
        //console.log(">>>>>>>>>>  messages: " +JSON.stringify(messages));
        const response = await secureFetch(this.host + "/api/chat", {
            method: "POST",
            signal,
            headers: { 
                "Content-Type": "application/json", 
            },
            body: JSON.stringify({ 
                model: this.model, 
                messages: messages,
                stream: this.stream,
                think: this.think,
                ...(this.format_json ? { format: "json" } : {}),
                ...((this.num_ctx > 0 || (this.temperature != '' && !Number.isNaN(tempFloat))) ? {
                    options: {
                        ...(this.num_ctx > 0 ? { num_ctx: parseInt(this.num_ctx) } : {}),
                        ...(this.temperature != '' && !Number.isNaN(tempFloat) ? { temperature: tempFloat } : {}),
                    }
                } : {}),
            }),
        });
        return response;
      }catch (error) {
        if (error?.name === 'AbortError') throw error;
          console.error("[ThunderAI] Ollama API request failed: ");
          let output = {};
          output.is_exception = true;
          output.ok = false;
          output.error = "Ollama API request failed: " + redactApiError(error, this.apiKey);
          return output;
      }
    }

}
